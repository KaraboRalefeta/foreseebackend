import { NextRequest } from "next/server";

import {
  bearerTokenFromAuthorization,
  getAuthenticatedUser,
} from "@/lib/auth/clerk";
import { computeAffordability } from "@/lib/ai/affordability";
import {
  buildResolverPromptInput,
  deterministicResolve,
  reconcileResolverOutput,
} from "@/lib/ai/context-resolver";
import {
  buildCompletedResponse,
  enforceDraftSafety,
  mergePendingIntent,
  type PendingIntent,
} from "@/lib/ai/draft-safety";
import { loadMonthlyFinanceContext } from "@/lib/ai/finance-context";
import {
  callContextResolverModel,
  callFinanceAdvisorModel,
  getAiConfig,
} from "@/lib/ai/openai";
import { buildChatPromptPayload } from "@/lib/ai/chat-prompt";
import { addAiLog } from "@/lib/ai/logs";
import { normalizeChatOutput } from "@/lib/ai/normalize";
import { chatModelOutputSchema, chatRequestSchema, type ChatRequest } from "@/lib/ai/schemas";
import {
  clearPendingIntent,
  getPendingIntent,
  getRecentConversation,
  persistConversationTurn,
  savePendingIntent,
} from "@/lib/ai/chat-state";
import { ApiError, fromUnknownError } from "@/lib/http/errors";
import {
  createRequestId,
  errorResponse,
  optionsResponse,
  successResponse,
} from "@/lib/http/response";

export const runtime = "nodejs";

type ChatRouteData = ReturnType<typeof normalizeChatOutput>;

type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function zeroUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function readRequiredSessionId(parsed: ChatRequest): string {
  const sessionId = parsed.session?.sessionId ?? parsed.sessionId;
  if (!sessionId) {
    throw new ApiError(400, "BAD_REQUEST", "sessionId is required.");
  }
  return sessionId;
}

function readRequiredMonthKey(parsed: ChatRequest): string {
  const monthKey = parsed.context?.monthKey ?? parsed.monthKey;
  if (!monthKey) {
    throw new ApiError(400, "BAD_REQUEST", "monthKey is required.");
  }
  return monthKey;
}

function toPendingIntent(value: ChatRequest["pendingIntent"]): PendingIntent | null {
  return value && value.intent !== "Unknown" ? value : null;
}

function buildAdvisorPromptInput(params: {
  request: ChatRequest;
  resolver: unknown;
  affordabilityCheck: unknown;
}): string {
  const payload = buildChatPromptPayload(params.request) as Record<string, unknown>;
  const derivedContext =
    payload.derivedContext && typeof payload.derivedContext === "object"
      ? (payload.derivedContext as Record<string, unknown>)
      : {};

  return JSON.stringify(
    {
      ...payload,
      task: "Compose a Sovereign Concierge finance response.",
      resolvedContext: params.resolver,
      derivedContext: {
        ...derivedContext,
        affordabilityCheck: params.affordabilityCheck,
      },
    },
    null,
    2,
  );
}

async function persistTurnPair(params: {
  user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  sessionId: string;
  userMessage: string;
  assistantReply: string;
}): Promise<void> {
  await persistConversationTurn({
    user: params.user,
    sessionId: params.sessionId,
    role: "user",
    content: params.userMessage,
  });
  await persistConversationTurn({
    user: params.user,
    sessionId: params.sessionId,
    role: "assistant",
    content: params.assistantReply,
  });
}

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const config = getAiConfig();
  let requestPreview = "unavailable";
  let inputPreview = "chat request failed before a valid model response was returned";

  try {
    const token = bearerTokenFromAuthorization(req.headers.get("authorization"));
    const user = await getAuthenticatedUser(token);
    const rawBody = await req.text().catch(() => {
      throw new ApiError(400, "BAD_REQUEST", "Invalid request body.");
    });
    requestPreview = rawBody.slice(0, 1200);

    const body = (() => {
      try {
        return JSON.parse(rawBody) as unknown;
      } catch {
        throw new ApiError(400, "BAD_REQUEST", "Invalid JSON request body.");
      }
    })();
    const parsed = chatRequestSchema.parse(body);
    inputPreview = parsed.message;

    if (parsed.message.length > config.maxInputChars) {
      throw new ApiError(400, "BAD_REQUEST", "message exceeds AI_MAX_INPUT_CHARS.", {
        fieldErrors: {
          message: [`Message must be <= ${config.maxInputChars} characters.`],
        },
      });
    }

    const sessionId = readRequiredSessionId(parsed);
    const monthKey = readRequiredMonthKey(parsed);
    const deviceId = parsed.session?.deviceId ?? parsed.deviceId;

    if (parsed.appConfirmedAction && parsed.completedAction) {
      const data = buildCompletedResponse(parsed.completedAction);
      await clearPendingIntent(user, sessionId);
      await persistTurnPair({
        user,
        sessionId,
        userMessage: parsed.message,
        assistantReply: data.reply,
      });

      const latencyMs = Date.now() - startedAt;
      const usage = zeroUsage();
      addAiLog({
        requestId,
        timestampIso: new Date().toISOString(),
        endpoint: "/api/ai/chat",
        ok: true,
        model: `${config.chatModel}:deterministic_completion`,
        latencyMs,
        usage,
        inputPreview: parsed.message,
        outputPreview: data.reply,
        warnings: data.warnings,
      });

      return successResponse<ChatRouteData>(req, {
        ok: true,
        requestId,
        mode: "chat",
        model: `${config.chatModel}:deterministic_completion`,
        latencyMs,
        usage,
        data,
      });
    }

    const [serverContext, storedPendingIntent, storedConversation] = await Promise.all([
      loadMonthlyFinanceContext({
        user,
        monthKey,
        currency: parsed.context?.currency,
        locale: parsed.context?.locale,
        timezone: parsed.context?.timezone,
      }),
      getPendingIntent(user, sessionId),
      getRecentConversation(user, sessionId),
    ]);

    const pendingIntent = storedPendingIntent ?? toPendingIntent(parsed.pendingIntent);
    const conversation = storedConversation.length > 0 ? storedConversation : (parsed.conversation ?? []);
    const canonicalRequest: ChatRequest = {
      ...parsed,
      session: {
        sessionId,
        deviceId,
        assistantPersona: parsed.session?.assistantPersona,
      },
      context: serverContext,
      conversation,
      pendingIntent,
      uiState: parsed.uiState,
    };

    const deterministicResolver = deterministicResolve({
      message: parsed.message,
      conversation,
      pendingIntent,
      context: serverContext,
      uiState: parsed.uiState,
    });
    const resolverPromptInput = buildResolverPromptInput({
      message: parsed.message,
      conversation,
      pendingIntent,
      context: serverContext,
      uiState: parsed.uiState,
    });

    if (resolverPromptInput.length > config.maxInputChars) {
      throw new ApiError(400, "BAD_REQUEST", "Resolver payload exceeds AI_MAX_INPUT_CHARS.");
    }

    const resolverModelResult = await callContextResolverModel({
      promptInput: resolverPromptInput,
      maxOutputTokens: Math.min(config.maxOutputTokens, 1200),
    });
    const resolver = reconcileResolverOutput(resolverModelResult.result, deterministicResolver);
    const updatedPendingIntent = mergePendingIntent(pendingIntent, resolver, {
      monthKey,
      todayIso: serverContext.todayIso ?? new Date().toISOString().slice(0, 10),
    });
    const amountForAffordability =
      resolver.requestedAmountCents ??
      (typeof updatedPendingIntent?.draftCandidate.amountCents === "number"
        ? updatedPendingIntent.draftCandidate.amountCents
        : null);
    const affordability = computeAffordability({
      message: parsed.message,
      context: serverContext,
      requestedAmountCents: amountForAffordability,
    });
    const advisorRequest: ChatRequest = {
      ...canonicalRequest,
      pendingIntent: updatedPendingIntent,
    };
    const advisorPromptInput = buildAdvisorPromptInput({
      request: advisorRequest,
      resolver,
      affordabilityCheck: affordability.affordabilityCheck,
    });

    if (advisorPromptInput.length > config.maxInputChars) {
      throw new ApiError(400, "BAD_REQUEST", "Advisor payload exceeds AI_MAX_INPUT_CHARS.");
    }

    const advisorModelResult = await callFinanceAdvisorModel({
      promptInput: advisorPromptInput,
      maxOutputTokens: config.maxOutputTokens,
    });
    const modelData = chatModelOutputSchema.parse(advisorModelResult.result);
    const normalized = normalizeChatOutput(modelData, advisorRequest);
    const data = enforceDraftSafety({
      data: normalized,
      resolver,
      pendingIntent: updatedPendingIntent,
    });

    if (resolver.classification === "RejectPendingAction" || data.status === "completed") {
      await clearPendingIntent(user, sessionId);
    } else if (data.pendingIntent) {
      await savePendingIntent(user, sessionId, data.pendingIntent);
    }

    await persistTurnPair({
      user,
      sessionId,
      userMessage: parsed.message,
      assistantReply: data.reply,
    });

    const latencyMs = Date.now() - startedAt;
    const usage = addUsage(resolverModelResult.usage, advisorModelResult.usage);
    const model = `${resolverModelResult.model}:resolver+${advisorModelResult.model}:advisor`;
    addAiLog({
      requestId,
      timestampIso: new Date().toISOString(),
      endpoint: "/api/ai/chat",
      ok: true,
      model,
      latencyMs,
      usage,
      inputPreview: parsed.message,
      outputPreview: data.reply,
      warnings: data.warnings,
      requestDebug: {
        hasContext: true,
        hasConversation: conversation.length > 0,
        conversationLength: conversation.length,
        hasPendingIntent: Boolean(updatedPendingIntent),
        hasUiState: Boolean(parsed.uiState),
        topLevelKeys: Object.keys((body as Record<string, unknown>) ?? {}).slice(0, 20),
      },
    });

    console.info("ai_request", {
      requestId,
      endpoint: "/api/ai/chat",
      model,
      latencyMs,
      usage,
      userId: user.id,
      sessionId,
      deviceId,
      resolverClassification: resolver.classification,
    });

    return successResponse<ChatRouteData>(req, {
      ok: true,
      requestId,
      mode: "chat",
      model,
      latencyMs,
      usage,
      data,
    });
  } catch (error) {
    const apiError = fromUnknownError(error);
    const latencyMs = Date.now() - startedAt;
    addAiLog({
      requestId,
      timestampIso: new Date().toISOString(),
      endpoint: "/api/ai/chat",
      ok: false,
      latencyMs,
      inputPreview:
        inputPreview === "chat request failed before a valid model response was returned"
          ? requestPreview
          : inputPreview,
      error: {
        code: apiError.code,
        message: apiError.message,
      },
    });

    console.warn("ai_request_error", {
      requestId,
      endpoint: "/api/ai/chat",
      code: apiError.code,
      status: apiError.status,
      latencyMs,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage:
        error instanceof Error ? error.message.slice(0, 240) : "non-error thrown value",
    });

    return errorResponse(
      req,
      {
        ok: false,
        requestId,
        error: {
          code: apiError.code,
          message: apiError.message,
          details: apiError.details,
        },
      },
      apiError.status,
    );
  }
}

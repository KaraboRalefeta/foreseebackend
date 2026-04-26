import { NextRequest } from "next/server";

import { callChatModel, getAiConfig } from "@/lib/ai/openai";
import { buildChatPromptInput } from "@/lib/ai/chat-prompt";
import { addAiLog } from "@/lib/ai/logs";
import { normalizeChatOutput } from "@/lib/ai/normalize";
import { chatModelOutputSchema, chatRequestSchema } from "@/lib/ai/schemas";
import { ApiError, fromUnknownError } from "@/lib/http/errors";
import {
  createRequestId,
  errorResponse,
  optionsResponse,
  successResponse,
} from "@/lib/http/response";

export const runtime = "nodejs";

type ChatRouteData = ReturnType<typeof normalizeChatOutput>;

function looksLikeConfirmation(message: string): boolean {
  return /^(yes|yep|yeah|ok|okay|sure|confirm|please do|do it|go ahead|sounds good|let's do that|lets do that)\b/i.test(
    message.trim(),
  );
}

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const config = getAiConfig();
  let requestPreview = "unavailable";
  let requestDebug:
    | {
        topLevelKeys?: string[];
        hasContext?: boolean;
        hasConversation?: boolean;
        conversationLength?: number;
        hasPendingIntent?: boolean;
        hasUiState?: boolean;
      }
    | undefined;
  let inputPreview = "chat request failed before a valid model response was returned";

  try {
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError(400, "BAD_REQUEST", "JSON body must be an object.");
    }

    const untypedBody = body as Record<string, unknown>;
    requestDebug = {
      topLevelKeys: Object.keys(untypedBody).slice(0, 20),
      hasContext: typeof untypedBody.context === "object" && untypedBody.context !== null,
      hasConversation: Array.isArray(untypedBody.conversation),
      conversationLength: Array.isArray(untypedBody.conversation)
        ? untypedBody.conversation.length
        : undefined,
      hasPendingIntent: untypedBody.pendingIntent !== undefined && untypedBody.pendingIntent !== null,
      hasUiState: typeof untypedBody.uiState === "object" && untypedBody.uiState !== null,
    };

    const parsed = chatRequestSchema.parse(body);
    inputPreview = parsed.message;
    if (parsed.message.length > config.maxInputChars) {
      throw new ApiError(400, "BAD_REQUEST", "message exceeds AI_MAX_INPUT_CHARS.", {
        fieldErrors: {
          message: [`Message must be <= ${config.maxInputChars} characters.`],
        },
      });
    }

    const canDeterministicConfirm =
      looksLikeConfirmation(parsed.message) &&
      parsed.pendingIntent &&
      parsed.pendingIntent.intent !== "Unknown" &&
      parsed.pendingIntent.missingFields.length === 0 &&
      Object.keys(parsed.pendingIntent.draftCandidate ?? {}).length > 0;

    if (canDeterministicConfirm) {
      const data = normalizeChatOutput(
        chatModelOutputSchema.parse({
          status: "action_confirmation",
          responseMode: "propose_action",
          confidence: 0.93,
          reply: "Confirmed. I prepared the draft for your review.",
          pendingIntent: parsed.pendingIntent,
          needsReview: true,
          missingFields: [],
          warnings: [],
          assumptions: [],
        }),
        parsed,
      );

      const latencyMs = Date.now() - startedAt;
      const usage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };

      addAiLog({
        requestId,
        timestampIso: new Date().toISOString(),
        endpoint: "/api/ai/chat",
        ok: true,
        model: `${config.chatModel}:deterministic_confirmation`,
        latencyMs,
        usage,
        inputPreview: parsed.message,
        outputPreview: data.reply,
        warnings: data.warnings,
        requestDebug,
      });

      console.info("ai_request", {
        requestId,
        endpoint: "/api/ai/chat",
        model: `${config.chatModel}:deterministic_confirmation`,
        latencyMs,
        usage,
      });

      return successResponse<ChatRouteData>(req, {
        ok: true,
        requestId,
        mode: "chat",
        model: `${config.chatModel}:deterministic_confirmation`,
        latencyMs,
        usage,
        data,
      });
    }

    const promptInput = buildChatPromptInput(parsed);

    if (promptInput.length > config.maxInputChars) {
      throw new ApiError(400, "BAD_REQUEST", "Request payload exceeds AI_MAX_INPUT_CHARS.", {
        fieldErrors: {
          message: [
            `Payload for AI model must be <= ${config.maxInputChars} characters after normalization.`,
          ],
        },
      });
    }

    const modelResult = await callChatModel({
      promptInput,
      maxOutputTokens: config.maxOutputTokens,
    });

    const modelData = chatModelOutputSchema.parse(modelResult.result);
    const data = normalizeChatOutput(modelData, parsed);

    const latencyMs = Date.now() - startedAt;
    addAiLog({
      requestId,
      timestampIso: new Date().toISOString(),
      endpoint: "/api/ai/chat",
      ok: true,
      model: modelResult.model,
      latencyMs,
      usage: modelResult.usage,
      inputPreview: parsed.message,
      outputPreview: data.reply,
      warnings: data.warnings,
      requestDebug,
    });

    console.info("ai_request", {
      requestId,
      endpoint: "/api/ai/chat",
      model: modelResult.model,
      latencyMs,
      usage: modelResult.usage,
    });

    return successResponse<ChatRouteData>(req, {
      ok: true,
      requestId,
      mode: "chat",
      model: modelResult.model,
      latencyMs,
      usage: modelResult.usage,
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
      requestDebug,
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
      requestDebug,
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

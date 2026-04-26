import { NextRequest } from "next/server";

import { callParseModel, getAiConfig } from "@/lib/ai/openai";
import { addAiLog } from "@/lib/ai/logs";
import { coerceParseModelOutput, normalizeParseOutput } from "@/lib/ai/normalize";
import { parseRequestSchema } from "@/lib/ai/schemas";
import { ApiError, fromUnknownError } from "@/lib/http/errors";
import {
  createRequestId,
  errorResponse,
  optionsResponse,
  successResponse,
} from "@/lib/http/response";

export const runtime = "nodejs";

type ParseRouteData = ReturnType<typeof normalizeParseOutput>;

function buildPromptInput(payload: ReturnType<typeof parseRequestSchema.parse>): string {
  return JSON.stringify(
    {
      task: "Parse a finance command into one DraftAction.",
      request: {
        input: payload.input,
        monthKey: payload.monthKey,
        defaultDateIso: payload.defaultDateIso ?? null,
        currency: payload.currency ?? "ZAR",
      },
      constraints: {
        allowedIntents: [
          "Expense",
          "Income",
          "PlannedSpend",
          "UpcomingBill",
          "SplitExpense",
          "DebtRepayment",
          "Unknown",
        ],
        notes: [
          "Money values must be integer cents.",
          "Dates must be YYYY-MM-DD.",
          "When uncertain, return Unknown with warnings and needsReview=true.",
        ],
      },
    },
    null,
    2,
  );
}

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const config = getAiConfig();

  try {
    const body = await req.json().catch(() => {
      throw new ApiError(400, "BAD_REQUEST", "Invalid JSON request body.");
    });

    const parsed = parseRequestSchema.parse(body);

    if (parsed.input.length > config.maxInputChars) {
      throw new ApiError(400, "BAD_REQUEST", "input exceeds AI_MAX_INPUT_CHARS.", {
        fieldErrors: {
          input: [`Input must be <= ${config.maxInputChars} characters.`],
        },
      });
    }

    const promptInput = buildPromptInput(parsed);

    if (promptInput.length > config.maxInputChars) {
      throw new ApiError(400, "BAD_REQUEST", "Request payload exceeds AI_MAX_INPUT_CHARS.", {
        fieldErrors: {
          input: [
            `Payload for AI model must be <= ${config.maxInputChars} characters after normalization.`,
          ],
        },
      });
    }

    const modelResult = await callParseModel({
      promptInput,
      maxOutputTokens: config.maxOutputTokens,
    });

    const modelData = coerceParseModelOutput(modelResult.result, parsed);
    const data = normalizeParseOutput(modelData, parsed);

    const latencyMs = Date.now() - startedAt;
    addAiLog({
      requestId,
      timestampIso: new Date().toISOString(),
      endpoint: "/api/ai/parse",
      ok: true,
      model: modelResult.model,
      latencyMs,
      usage: modelResult.usage,
      inputPreview: parsed.input,
      outputPreview: `${data.intent}: ${data.summary}`,
      warnings: data.warnings,
    });

    console.info("ai_request", {
      requestId,
      endpoint: "/api/ai/parse",
      model: modelResult.model,
      latencyMs,
      usage: modelResult.usage,
    });

    return successResponse<ParseRouteData>(req, {
      ok: true,
      requestId,
      mode: "parse",
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
      endpoint: "/api/ai/parse",
      ok: false,
      latencyMs,
      inputPreview: "parse request failed before a valid model response was returned",
      error: {
        code: apiError.code,
        message: apiError.message,
      },
    });

    console.warn("ai_request_error", {
      requestId,
      endpoint: "/api/ai/parse",
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

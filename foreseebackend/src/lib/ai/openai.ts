import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { CHAT_SYSTEM_PROMPT, PARSE_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { chatModelOutputSchema, parseModelOutputSchema } from "@/lib/ai/schemas";
import { ApiError } from "@/lib/http/errors";

const DEFAULT_CHAT_MODEL = "gpt-5.4-mini";
const DEFAULT_PARSE_MODEL = "gpt-5.4-mini";
const DEFAULT_MAX_INPUT_CHARS = 6000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2000;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ModelCallResult = {
  model: string;
  outputText: string;
  usage: Usage;
  parsedOutput: unknown | null;
};

export type AiConfig = {
  chatModel: string;
  parseModel: string;
  maxInputChars: number;
  maxOutputTokens: number;
  allowedOriginsRaw?: string;
};

let cachedClient: OpenAI | null = null;

function safeZodTextFormat(params: {
  schema: unknown;
  name: string;
  description: string;
}):
  | ReturnType<typeof zodTextFormat<typeof chatModelOutputSchema>>
  | ReturnType<typeof zodTextFormat<typeof parseModelOutputSchema>>
  | undefined {
  try {
    return zodTextFormat(params.schema as never, params.name, {
      description: params.description,
    });
  } catch (error) {
    console.warn("ai_schema_format_fallback", {
      schemaName: params.name,
      message: error instanceof Error ? error.message : "unknown schema formatting error",
    });
    return undefined;
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const asInt = Math.floor(parsed);
  return asInt > 0 ? asInt : fallback;
}

export function getAiConfig(): AiConfig {
  return {
    chatModel: process.env.OPENAI_MODEL_CHAT ?? DEFAULT_CHAT_MODEL,
    parseModel: process.env.OPENAI_MODEL_PARSE ?? DEFAULT_PARSE_MODEL,
    maxInputChars: readPositiveInt(process.env.AI_MAX_INPUT_CHARS, DEFAULT_MAX_INPUT_CHARS),
    maxOutputTokens: readPositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
    allowedOriginsRaw: process.env.AI_ALLOWED_ORIGINS,
  };
}

function getClient(): OpenAI {
  if (!cachedClient) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new ApiError(500, "INTERNAL", "OPENAI_API_KEY is missing on the server.");
    }

    cachedClient = new OpenAI({ apiKey });
  }

  return cachedClient;
}

function extractText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text;
  }

  const chunks: string[] = [];

  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function mapUsage(response: OpenAI.Responses.Response): Usage {
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // fall through to typed error below
      }
    }

    throw new ApiError(502, "MODEL_ERROR", "Model response was not valid JSON.");
  }
}

function isTransientProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeStatus = (error as Error & { status?: number }).status;
  if (maybeStatus && [408, 409, 429, 500, 502, 503, 504].includes(maybeStatus)) {
    return true;
  }

  return /timeout|temporar|rate|unavailable|overloaded|network/i.test(error.message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === MAX_RETRIES;
      if (!isTransientProviderError(error) || isLast) {
        throw error;
      }

      const backoffMs = 250 * 2 ** attempt + Math.floor(Math.random() * 100);
      await sleep(backoffMs);
      attempt += 1;
    }
  }

  throw new ApiError(502, "MODEL_ERROR", "Model request failed after retries.");
}

async function callModel(params: {
  model: string;
  userInput: string;
  systemPrompt: string;
  maxOutputTokens: number;
  textFormat?:
    | ReturnType<typeof zodTextFormat<typeof chatModelOutputSchema>>
    | ReturnType<typeof zodTextFormat<typeof parseModelOutputSchema>>;
}): Promise<ModelCallResult> {
  const client = getClient();
  const isInvalidSchemaError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }

    const status = (error as Error & { status?: number }).status;
    const code = String((error as Error & { code?: unknown }).code ?? "");
    const param = String((error as Error & { param?: unknown }).param ?? "");
    const message = error.message.toLowerCase();

    return (
      status === 400 &&
      (code.toLowerCase().includes("invalid_json_schema") ||
        param.toLowerCase().includes("text.format.schema") ||
        message.includes("invalid schema for response_format"))
    );
  };

  const response = await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const body = {
        model: params.model,
        input: [
          {
            role: "system" as const,
            content: [{ type: "input_text" as const, text: params.systemPrompt }],
          },
          {
            role: "user" as const,
            content: [{ type: "input_text" as const, text: params.userInput }],
          },
        ],
        max_output_tokens: params.maxOutputTokens,
        ...(params.textFormat
          ? {
              text: {
                format: params.textFormat,
              },
            }
          : {}),
      };

      if (!params.textFormat) {
        return await client.responses.create(body, { signal: controller.signal });
      }

      try {
        return await client.responses.parse(body, { signal: controller.signal });
      } catch (error) {
        if (!isInvalidSchemaError(error)) {
          throw error;
        }

        console.warn("ai_schema_response_fallback", {
          message: error instanceof Error ? error.message : "Unknown invalid schema error",
        });

        return await client.responses.create(
          {
            model: params.model,
            input: body.input,
            max_output_tokens: params.maxOutputTokens,
          },
          { signal: controller.signal },
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  });

  const outputText = extractText(response);
  if (!outputText) {
    throw new ApiError(502, "MODEL_ERROR", "Model returned an empty response.");
  }

  return {
    model: response.model ?? params.model,
    outputText,
    usage: mapUsage(response),
    parsedOutput: "output_parsed" in response ? response.output_parsed : null,
  };
}

export async function callChatModel(args: {
  promptInput: string;
  model?: string;
  maxOutputTokens: number;
}): Promise<{ result: unknown; model: string; usage: Usage }> {
  const model = args.model ?? getAiConfig().chatModel;
  const textFormat = safeZodTextFormat({
    schema: chatModelOutputSchema,
    name: "foresee_chat_response",
    description: "Structured Sovereign Concierge finance chat response.",
  });
  const call = await callModel({
    model,
    userInput: args.promptInput,
    systemPrompt: CHAT_SYSTEM_PROMPT,
    maxOutputTokens: args.maxOutputTokens,
    textFormat,
  });

  return {
    result:
      call.parsedOutput ??
      chatModelOutputSchema.parse(parseJsonText(call.outputText)),
    model: call.model,
    usage: call.usage,
  };
}

export async function callParseModel(args: {
  promptInput: string;
  model?: string;
  maxOutputTokens: number;
}): Promise<{ result: unknown; model: string; usage: Usage }> {
  const model = args.model ?? getAiConfig().parseModel;
  const textFormat = safeZodTextFormat({
    schema: parseModelOutputSchema,
    name: "foresee_parse_response",
    description: "Structured finance parse result for a single draft action.",
  });
  const call = await callModel({
    model,
    userInput: args.promptInput,
    systemPrompt: PARSE_SYSTEM_PROMPT,
    maxOutputTokens: args.maxOutputTokens,
    textFormat,
  });

  return {
    result:
      call.parsedOutput ??
      parseModelOutputSchema.parse(parseJsonText(call.outputText)),
    model: call.model,
    usage: call.usage,
  };
}

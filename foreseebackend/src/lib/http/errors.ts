import { ZodError } from "zod";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "MODEL_ERROR"
  | "INTERNAL";

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function fromUnknownError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const zodLikeError =
    error instanceof ZodError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "ZodError");

  if (zodLikeError) {
    const fieldErrors =
      typeof (error as { flatten?: unknown }).flatten === "function"
        ? ((error as { flatten: () => { fieldErrors: Record<string, unknown> } }).flatten()
            .fieldErrors ?? {})
        : {};
    return new ApiError(400, "BAD_REQUEST", "Request payload validation failed.", {
      fieldErrors,
    });
  }

  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    const name = (error as Error & { name?: string }).name ?? "";
    const message = error.message ?? "";
    const lower = `${name} ${message}`.toLowerCase();

    if (status === 401 || status === 403) {
      return new ApiError(401, "UNAUTHORIZED", "AI provider authentication failed.");
    }

    if (status === 429) {
      return new ApiError(429, "RATE_LIMITED", "Provider rate limit reached. Please retry shortly.");
    }

    if (status && status >= 400 && status < 500) {
      return new ApiError(400, "BAD_REQUEST", "Request could not be processed.");
    }

    if (status && status >= 500) {
      return new ApiError(502, "MODEL_ERROR", "AI provider returned an upstream error.");
    }

    if (
      name === "AbortError" ||
      /api(connection|error)|openai|timeout|timed out|network|fetch|econn|enotfound|eai_again|socket|upstream|provider|overloaded|unavailable/.test(
        lower,
      )
    ) {
      return new ApiError(502, "MODEL_ERROR", "AI provider request failed. Please retry shortly.");
    }
  }

  return new ApiError(500, "INTERNAL", "Unexpected server error.");
}

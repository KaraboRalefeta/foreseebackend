import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getAiConfig } from "@/lib/ai/openai";
import type { ErrorCode } from "@/lib/http/errors";

export type SuccessEnvelope<T> = {
  ok: true;
  requestId: string;
  mode: "chat" | "parse";
  model: string;
  latencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  data: T;
};

export type ErrorEnvelope = {
  ok: false;
  requestId: string;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

export function createRequestId(): string {
  return randomUUID();
}

function parseAllowedOrigins(): string[] {
  const raw = getAiConfig().allowedOriginsRaw;

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveAccessControlAllowOrigin(req: NextRequest): string {
  const allowed = parseAllowedOrigins();
  const requestOrigin = req.headers.get("origin");

  if (process.env.NODE_ENV !== "production" && allowed.length === 0) {
    return "*";
  }

  if (!requestOrigin || allowed.length === 0) {
    return "null";
  }

  return allowed.includes(requestOrigin) ? requestOrigin : "null";
}

export function responseHeaders(req: NextRequest): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": resolveAccessControlAllowOrigin(req),
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-request-id",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

export function successResponse<T>(
  req: NextRequest,
  body: SuccessEnvelope<T>,
  status = 200,
): NextResponse<SuccessEnvelope<T>> {
  return NextResponse.json(body, {
    status,
    headers: responseHeaders(req),
  });
}

export function errorResponse(
  req: NextRequest,
  body: ErrorEnvelope,
  status: number,
): NextResponse<ErrorEnvelope> {
  return NextResponse.json(body, {
    status,
    headers: responseHeaders(req),
  });
}

export function optionsResponse(req: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: responseHeaders(req),
  });
}

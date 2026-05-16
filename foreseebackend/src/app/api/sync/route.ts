import { NextRequest, NextResponse } from "next/server";

import {
  bearerTokenFromAuthorization,
  getAuthenticatedUser,
} from "@/lib/auth/clerk";
import { ApiError, fromUnknownError } from "@/lib/http/errors";
import { pullChanges, pushChanges } from "@/lib/sync/service";
import { syncExchangeRequestSchema } from "@/lib/sync/schemas";
import {
  createRequestId,
  errorResponse,
  optionsResponse,
  responseHeaders,
} from "@/lib/http/response";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const startedAt = Date.now();

  try {
    const token = bearerTokenFromAuthorization(req.headers.get("authorization"));
    const user = await getAuthenticatedUser(token);
    const body = await req.json().catch(() => {
      throw new ApiError(400, "BAD_REQUEST", "Invalid JSON request body.");
    });

    const parsed = syncExchangeRequestSchema.parse(body);
    const push = await pushChanges(parsed.changes, user, parsed.deviceId);
    const serverTime = new Date().toISOString();
    const changes = await pullChanges(user, parsed.since);

    return NextResponse.json(
      {
        ok: push.rejected.length === 0,
        requestId,
        serverTime,
        latencyMs: Date.now() - startedAt,
        accepted: push.accepted,
        rejected: push.rejected,
        changes,
      },
      {
        status: 200,
        headers: responseHeaders(req),
      },
    );
  } catch (error) {
    const apiError = fromUnknownError(error);

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

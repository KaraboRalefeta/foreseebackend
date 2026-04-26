import { NextRequest, NextResponse } from "next/server";

import { ApiError, fromUnknownError } from "@/lib/http/errors";
import {
  createRequestId,
  errorResponse,
  optionsResponse,
  responseHeaders,
} from "@/lib/http/response";
import { bearerTokenFromAuthorization, getSupabaseUser } from "@/lib/supabase/client";
import { pullChanges } from "@/lib/sync/service";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function GET(req: NextRequest) {
  const requestId = createRequestId();

  try {
    const token = bearerTokenFromAuthorization(req.headers.get("authorization"));
    const user = await getSupabaseUser(token);
    const since = req.nextUrl.searchParams.get("since") ?? undefined;

    if (since && Number.isNaN(Date.parse(since))) {
      throw new ApiError(400, "BAD_REQUEST", "since must be a valid ISO-8601 date-time.");
    }

    const serverTime = new Date().toISOString();
    const changes = await pullChanges(user, since);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        serverTime,
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

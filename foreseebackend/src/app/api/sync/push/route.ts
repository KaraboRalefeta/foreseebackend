import { NextRequest, NextResponse } from "next/server";

import { bearerTokenFromAuthorization, getAuthenticatedUser } from "@/lib/auth/clerk";
import { ApiError, fromUnknownError } from "@/lib/http/errors";
import {
  createRequestId,
  errorResponse,
  optionsResponse,
  responseHeaders,
} from "@/lib/http/response";
import { syncPushRequestSchema } from "@/lib/sync/schemas";
import { pushChanges } from "@/lib/sync/service";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();

  try {
    const token = bearerTokenFromAuthorization(req.headers.get("authorization"));
    const user = await getAuthenticatedUser(token);
    const body = await req.json().catch(() => {
      throw new ApiError(400, "BAD_REQUEST", "Invalid JSON request body.");
    });

    const parsed = syncPushRequestSchema.parse(body);
    const result = await pushChanges(parsed.changes, user, parsed.deviceId);

    return NextResponse.json(
      {
        ok: result.rejected.length === 0,
        requestId,
        accepted: result.accepted,
        rejected: result.rejected,
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

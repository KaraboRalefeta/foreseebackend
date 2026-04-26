import { NextRequest, NextResponse } from "next/server";

import { getAiLogs } from "@/lib/ai/logs";
import { optionsResponse, responseHeaders } from "@/lib/http/response";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);

  const logs = await getAiLogs(limit);
  const note = process.env.BLOB_READ_WRITE_TOKEN
    ? "Persistent logs from Vercel Blob."
    : "Temporary in-memory logs. Set BLOB_READ_WRITE_TOKEN for persistent logs.";

  return NextResponse.json(
    {
      ok: true,
      count: logs.length,
      data: logs,
      note,
    },
    {
      status: 200,
      headers: responseHeaders(req),
    },
  );
}

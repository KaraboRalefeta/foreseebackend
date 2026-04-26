import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const isConfigured = Boolean(process.env.OPENAI_API_KEY);

  return NextResponse.json(
    {
      ok: true,
      service: "foreseebackend",
      timestamp: new Date().toISOString(),
      runtime: "nodejs",
      ai: {
        configured: isConfigured,
      },
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "access-control-allow-origin": req.headers.get("origin") ?? "*",
      },
    },
  );
}

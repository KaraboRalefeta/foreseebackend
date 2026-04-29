import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "./route";

describe("/api/ai/chat", () => {
  it("returns 401 when bearer token is missing", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          message: "Can I afford groceries?",
          sessionId: "session_123",
          monthKey: "2026-04",
        }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

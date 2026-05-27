import { afterEach, describe, expect, it, vi } from "vitest";

function legacyJwtWithRole(role: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64url");

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

async function loadClientWithEnv(serviceRoleKey: string) {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  return import("./client");
}

describe("supabaseRest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("accepts legacy service_role JWT keys", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { supabaseRest } = await loadClientWithEnv(legacyJwtWithRole("service_role"));

    await expect(supabaseRest("transactions")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects legacy anon JWT keys", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { supabaseRest } = await loadClientWithEnv(legacyJwtWithRole("anon"));

    await expect(supabaseRest("transactions")).rejects.toMatchObject({
      code: "INTERNAL",
      message: "SUPABASE_SERVICE_ROLE_KEY must use the service_role JWT. Current JWT role: anon.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects publishable keys", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { supabaseRest } = await loadClientWithEnv("sb_publishable_123");

    await expect(supabaseRest("transactions")).rejects.toMatchObject({
      code: "INTERNAL",
      message:
        "SUPABASE_SERVICE_ROLE_KEY must be the server-only service_role or secret key, not the publishable key.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

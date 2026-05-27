import { ApiError } from "@/lib/http/errors";

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

let cachedConfig: SupabaseConfig | null = null;

function readLegacyJwtRole(key: string): string | null {
  const [, payload] = key.split(".");
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      role?: unknown;
    };

    return typeof decoded.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

function assertServerOnlySupabaseKey(serviceRoleKey: string): void {
  if (serviceRoleKey.startsWith("sb_publishable_")) {
    throw new ApiError(
      500,
      "INTERNAL",
      "SUPABASE_SERVICE_ROLE_KEY must be the server-only service_role or secret key, not the publishable key.",
    );
  }

  if (!serviceRoleKey.startsWith("eyJ")) {
    return;
  }

  const role = readLegacyJwtRole(serviceRoleKey);
  if (role === "service_role") {
    return;
  }

  throw new ApiError(
    500,
    "INTERNAL",
    `SUPABASE_SERVICE_ROLE_KEY must use the service_role JWT. Current JWT role: ${role ?? "unknown"}.`,
  );
}

function getSupabaseConfig(): SupabaseConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new ApiError(500, "INTERNAL", "Supabase server environment is not configured.");
  }

  assertServerOnlySupabaseKey(serviceRoleKey);

  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(url).toString().replace(/\/$/, "");
  } catch {
    throw new ApiError(500, "INTERNAL", "SUPABASE_URL is not a valid URL.");
  }

  cachedConfig = {
    url: normalizedUrl,
    serviceRoleKey,
  };
  return cachedConfig;
}

function jsonHeaders(): HeadersInit {
  const config = getSupabaseConfig();

  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
  };
}

export type SupabaseQuery = Record<string, string | number | boolean>;

function buildUrl(path: string, query?: SupabaseQuery): string {
  const config = getSupabaseConfig();
  const url = new URL(`${config.url}/rest/v1/${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function supabaseRest<T>(
  path: string,
  init: RequestInit & { query?: SupabaseQuery } = {},
): Promise<T> {
  const { query, headers, ...requestInit } = init;
  const response = await fetch(buildUrl(path, query), {
    ...requestInit,
    headers: {
      ...jsonHeaders(),
      ...headers,
    },
    cache: "no-store",
  });

  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new ApiError(502, "MODEL_ERROR", "Supabase request failed.", {
      status: response.status,
      body: typeof body === "string" ? body.slice(0, 500) : body,
    });
  }

  return body as T;
}

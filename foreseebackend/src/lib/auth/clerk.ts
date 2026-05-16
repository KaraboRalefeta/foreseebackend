import { verifyToken } from "@clerk/backend";

import { ApiError } from "@/lib/http/errors";

type ClerkConfig = {
  secretKey: string;
  apiUrl?: string;
  audience?: string | string[];
  authorizedParties?: string[];
  jwtKey?: string;
};

let cachedConfig: ClerkConfig | null = null;

function readCommaSeparatedEnv(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries && entries.length > 0 ? entries : undefined;
}

function readClerkConfig(): ClerkConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new ApiError(500, "INTERNAL", "Clerk server environment is not configured.");
  }

  cachedConfig = {
    secretKey,
    apiUrl: process.env.CLERK_API_URL,
    audience: readCommaSeparatedEnv(process.env.CLERK_AUDIENCE),
    authorizedParties: readCommaSeparatedEnv(process.env.CLERK_AUTHORIZED_PARTIES),
    jwtKey: process.env.CLERK_JWT_KEY,
  };
  return cachedConfig;
}

export type AuthenticatedUser = {
  id: string;
  sessionId?: string;
};

export function bearerTokenFromAuthorization(authorization: string | null): string {
  const [scheme, token] = authorization?.split(" ") ?? [];

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing bearer access token.");
  }

  return token;
}

export async function getAuthenticatedUser(accessToken: string): Promise<AuthenticatedUser> {
  const config = readClerkConfig();

  try {
    const payload = await verifyToken(accessToken, {
      secretKey: config.secretKey,
      apiUrl: config.apiUrl,
      audience: config.audience,
      authorizedParties: config.authorizedParties,
      jwtKey: config.jwtKey,
    });

    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new ApiError(401, "UNAUTHORIZED", "Bearer token did not resolve to a Clerk user.");
    }

    return {
      id: payload.sub,
      sessionId: typeof payload.sid === "string" ? payload.sid : undefined,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired Clerk bearer token.");
  }
}

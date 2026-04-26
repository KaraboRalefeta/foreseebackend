import { list, put } from "@vercel/blob";

export type AiLogEntry = {
  requestId: string;
  timestampIso: string;
  endpoint: "/api/ai/chat" | "/api/ai/parse";
  ok: boolean;
  model?: string;
  latencyMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  inputPreview: string;
  outputPreview?: string;
  warnings?: string[];
  requestDebug?: {
    topLevelKeys?: string[];
    hasContext?: boolean;
    hasConversation?: boolean;
    conversationLength?: number;
    hasPendingIntent?: boolean;
    hasUiState?: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
};

const MAX_LOG_ENTRIES = 200;
const store: AiLogEntry[] = [];
const BLOB_PREFIX = "ai-logs";
const BLOB_ENABLED = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

function trimText(value: string, max = 500): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }

  return `${compact.slice(0, max)}...`;
}

export function addAiLog(entry: AiLogEntry): void {
  const normalizedEntry: AiLogEntry = {
    ...entry,
    inputPreview: trimText(entry.inputPreview),
    outputPreview: entry.outputPreview ? trimText(entry.outputPreview, 800) : undefined,
    warnings: entry.warnings?.slice(0, 8),
  };

  store.unshift(normalizedEntry);

  if (store.length > MAX_LOG_ENTRIES) {
    store.splice(MAX_LOG_ENTRIES);
  }

  if (!BLOB_ENABLED) {
    return;
  }

  const safeTimestamp = normalizedEntry.timestampIso.replace(/[^0-9TZ:-]/g, "_");
  const pathname = `${BLOB_PREFIX}/${safeTimestamp}_${normalizedEntry.requestId}.json`;

  void put(pathname, JSON.stringify(normalizedEntry), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 0,
  }).catch((error) => {
    console.warn("ai_log_persist_error", {
      requestId: normalizedEntry.requestId,
      message: error instanceof Error ? error.message : "Unknown blob write error",
    });
  });
}

async function getPersistentAiLogs(limit: number): Promise<AiLogEntry[]> {
  const listed = await list({
    prefix: `${BLOB_PREFIX}/`,
    limit,
    mode: "folded",
  });

  const blobs = listed.blobs.slice(0, limit);
  if (blobs.length === 0) {
    return [];
  }

  const responses = await Promise.all(
    blobs.map(async (blob) => {
      const response = await fetch(blob.url, { cache: "no-store" });
      if (!response.ok) {
        return null;
      }
      const parsed = (await response.json()) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      return parsed as AiLogEntry;
    }),
  );

  return responses.filter((entry): entry is AiLogEntry => Boolean(entry));
}

export async function getAiLogs(limit = 50): Promise<AiLogEntry[]> {
  const safeLimit = Math.max(1, Math.min(200, Number.isFinite(limit) ? limit : 50));

  if (!BLOB_ENABLED) {
    return store.slice(0, safeLimit);
  }

  try {
    const persistentLogs = await getPersistentAiLogs(safeLimit);
    if (persistentLogs.length > 0) {
      return persistentLogs;
    }
  } catch (error) {
    console.warn("ai_log_fetch_error", {
      message: error instanceof Error ? error.message : "Unknown blob read error",
    });
  }

  return store.slice(0, safeLimit);
}

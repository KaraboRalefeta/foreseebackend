import { pendingIntentSchema, type ChatRequest } from "@/lib/ai/schemas";
import type { AuthenticatedUser } from "@/lib/auth/clerk";
import type { PendingIntent } from "@/lib/ai/draft-safety";
import { supabaseRest } from "@/lib/supabase/client";

type PendingIntentRow = {
  pending_intent: unknown;
};

type ConversationRow = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export async function getPendingIntent(
  user: AuthenticatedUser,
  sessionId: string,
): Promise<PendingIntent | null> {
  const rows = await supabaseRest<PendingIntentRow[]>("ai_pending_intents", {
    method: "GET",
    query: {
      select: "pending_intent",
      user_id: `eq.${user.id}`,
      session_id: `eq.${sessionId}`,
      limit: 1,
    },
  });

  const parsed = pendingIntentSchema.safeParse(rows[0]?.pending_intent);
  return parsed.success ? parsed.data : null;
}

export async function savePendingIntent(
  user: AuthenticatedUser,
  sessionId: string,
  pendingIntent: PendingIntent,
): Promise<void> {
  await supabaseRest<unknown>("ai_pending_intents", {
    method: "POST",
    query: {
      on_conflict: "user_id,session_id",
    },
    headers: {
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: user.id,
      session_id: sessionId,
      pending_intent: pendingIntent,
    }),
  });
}

export async function clearPendingIntent(user: AuthenticatedUser, sessionId: string): Promise<void> {
  await supabaseRest<unknown>("ai_pending_intents", {
    method: "DELETE",
    query: {
      user_id: `eq.${user.id}`,
      session_id: `eq.${sessionId}`,
    },
  });
}

export async function getRecentConversation(
  user: AuthenticatedUser,
  sessionId: string,
  limit = 12,
): Promise<NonNullable<ChatRequest["conversation"]>> {
  const rows = await supabaseRest<ConversationRow[]>("ai_conversation_turns", {
    method: "GET",
    query: {
      select: "role,content,created_at",
      user_id: `eq.${user.id}`,
      session_id: `eq.${sessionId}`,
      order: "created_at.desc",
      limit,
    },
  });

  return rows
    .reverse()
    .map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: Date.parse(row.created_at),
    }));
}

export async function persistConversationTurn(params: {
  user: AuthenticatedUser;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
}): Promise<void> {
  await supabaseRest<unknown>("ai_conversation_turns", {
    method: "POST",
    body: JSON.stringify({
      user_id: params.user.id,
      session_id: params.sessionId,
      role: params.role,
      content: params.content,
    }),
  });
}

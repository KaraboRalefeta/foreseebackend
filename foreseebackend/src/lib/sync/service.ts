import { ZodError } from "zod";

import { ApiError } from "@/lib/http/errors";
import { supabaseRest, type AuthenticatedUser } from "@/lib/supabase/client";
import {
  normalizeEntityType,
  payloadSchemas,
  type EntityCollection,
  type SyncChange,
} from "@/lib/sync/schemas";

const tableByCollection: Record<EntityCollection, string> = {
  transactions: "transactions",
  income: "income",
  budgetCategories: "budget_categories",
  plannedSpending: "planned_spending",
  upcomingPayments: "upcoming_payments",
  debts: "debts",
};

type DbRow = Record<string, unknown> & {
  id: string;
  user_id: string;
  updated_at: string;
};

export type AcceptedChange = {
  entityType: EntityCollection;
  entityId: string;
  serverUpdatedAt: string;
};

export type RejectedChange = {
  entityType: string;
  entityId?: string;
  code: "VALIDATION_FAILED" | "FORBIDDEN" | "NOT_FOUND" | "SUPABASE_ERROR";
  message: string;
  index: number;
  details?: unknown;
};

export type PullChanges = Record<EntityCollection, Record<string, unknown>[]>;

export type PushResult = {
  accepted: AcceptedChange[];
  rejected: RejectedChange[];
};

function toSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toSnakeObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [toSnakeKey(key), item]));
}

function toCamelObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [toCamelKey(key), item]));
}

function zodDetails(error: ZodError): Record<string, unknown> {
  return {
    fieldErrors: error.flatten().fieldErrors,
  };
}

async function getExistingRow(collection: EntityCollection, entityId: string): Promise<DbRow | null> {
  const table = tableByCollection[collection];
  const rows = await supabaseRest<DbRow[]>(table, {
    method: "GET",
    query: {
      select: "id,user_id,updated_at",
      id: `eq.${entityId}`,
      limit: 1,
    },
  });

  return rows[0] ?? null;
}

async function applyUpsert(
  change: SyncChange,
  collection: EntityCollection,
  user: AuthenticatedUser,
  deviceId: string,
): Promise<AcceptedChange> {
  const payloadSchema = payloadSchemas[collection];
  const payloadResult = payloadSchema.safeParse(change.payload);

  if (!payloadResult.success) {
    throw new ApiError(400, "BAD_REQUEST", "Change payload validation failed.", zodDetails(payloadResult.error));
  }

  const existing = await getExistingRow(collection, change.entityId);

  if (existing && existing.user_id !== user.id) {
    throw new ApiError(403, "UNAUTHORIZED", "Cannot modify another user's finance row.");
  }

  const table = tableByCollection[collection];
  const rows = await supabaseRest<DbRow[]>(table, {
    method: "POST",
    query: {
      on_conflict: "id",
    },
    headers: {
      prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id: change.entityId,
      user_id: user.id,
      ...toSnakeObject(payloadResult.data),
      client_updated_at: change.clientUpdatedAt,
      last_modified_device_id: deviceId,
      deleted_at: null,
    }),
  });

  const row = rows[0];

  if (!row) {
    throw new ApiError(502, "MODEL_ERROR", "Supabase did not return the upserted row.");
  }

  return {
    entityType: collection,
    entityId: row.id,
    serverUpdatedAt: row.updated_at,
  };
}

async function applySoftDelete(
  change: SyncChange,
  collection: EntityCollection,
  user: AuthenticatedUser,
  deviceId: string,
): Promise<AcceptedChange> {
  const existing = await getExistingRow(collection, change.entityId);

  if (!existing) {
    throw new ApiError(404, "BAD_REQUEST", "Cannot delete a row that does not exist remotely.");
  }

  if (existing.user_id !== user.id) {
    throw new ApiError(403, "UNAUTHORIZED", "Cannot delete another user's finance row.");
  }

  const table = tableByCollection[collection];
  const deletedAt = new Date().toISOString();
  const rows = await supabaseRest<DbRow[]>(table, {
    method: "PATCH",
    query: {
      id: `eq.${change.entityId}`,
      user_id: `eq.${user.id}`,
    },
    headers: {
      prefer: "return=representation",
    },
    body: JSON.stringify({
      deleted_at: deletedAt,
      client_updated_at: change.clientUpdatedAt,
      last_modified_device_id: deviceId,
    }),
  });

  const row = rows[0];

  if (!row) {
    throw new ApiError(404, "BAD_REQUEST", "No matching row was deleted.");
  }

  return {
    entityType: collection,
    entityId: row.id,
    serverUpdatedAt: row.updated_at,
  };
}

function rejectedFromError(change: SyncChange, index: number, error: unknown): RejectedChange {
  const base = {
    entityType: change.entityType,
    entityId: change.entityId,
    index,
  };

  if (error instanceof ApiError) {
    if (error.status === 403 || error.status === 401) {
      return { ...base, code: "FORBIDDEN", message: error.message, details: error.details };
    }

    if (error.status === 404) {
      return { ...base, code: "NOT_FOUND", message: error.message, details: error.details };
    }

    if (error.status >= 500) {
      return { ...base, code: "SUPABASE_ERROR", message: error.message, details: error.details };
    }

    return { ...base, code: "VALIDATION_FAILED", message: error.message, details: error.details };
  }

  return { ...base, code: "SUPABASE_ERROR", message: "Unexpected sync error." };
}

export async function pushChanges(
  changes: SyncChange[],
  user: AuthenticatedUser,
  deviceId: string,
): Promise<PushResult> {
  const accepted: AcceptedChange[] = [];
  const rejected: RejectedChange[] = [];

  for (const [index, change] of changes.entries()) {
    try {
      const collection = normalizeEntityType(change.entityType);
      const result =
        change.operation === "upsert"
          ? await applyUpsert(change, collection, user, deviceId)
          : await applySoftDelete(change, collection, user, deviceId);

      accepted.push(result);
    } catch (error) {
      rejected.push(rejectedFromError(change, index, error));
    }
  }

  return { accepted, rejected };
}

export async function pullChanges(user: AuthenticatedUser, since?: string): Promise<PullChanges> {
  const entries = await Promise.all(
    (Object.entries(tableByCollection) as [EntityCollection, string][]).map(async ([collection, table]) => {
      const query: Record<string, string | number | boolean> = {
        select: "*",
        user_id: `eq.${user.id}`,
        order: "updated_at.asc",
      };

      if (since) {
        query.updated_at = `gt.${since}`;
      }

      const rows = await supabaseRest<Record<string, unknown>[]>(table, {
        method: "GET",
        query,
      });

      return [collection, rows.map(toCamelObject)] as const;
    }),
  );

  return Object.fromEntries(entries) as PullChanges;
}

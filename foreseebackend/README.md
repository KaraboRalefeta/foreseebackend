## ForeSee AI Backend (Next.js + Vercel)

Production-oriented, stateless AI backend for an Android personal finance client.

Safety model:
- Backend never mutates finances directly.
- Backend only returns reviewable draft actions for client-side user confirmation.

### Endpoints

- `GET /api/health`
- `POST /api/ai/chat`
- `POST /api/ai/parse`
- `GET /api/ai/logs` (persistent via Vercel Blob when configured)
- `POST /sync` or `POST /api/sync` (single push/pull exchange)
- `POST /sync/push` or `POST /api/sync/push`
- `GET /sync/pull?since=2026-04-26T10:00:00.000Z` or `/api/sync/pull`

### Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

### Environment variables

Required:
- `OPENAI_API_KEY`
- `CLERK_SECRET_KEY`
- `SUPABASE_URL` (server-side Supabase project URL)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only key used by trusted sync routes)

Optional:
- `OPENAI_MODEL_CHAT` (default: `gpt-5.4-mini`)
- `OPENAI_MODEL_PARSE` (default: `gpt-5.4-mini`)
- `AI_MAX_INPUT_CHARS` (default: `6000`)
- `AI_MAX_OUTPUT_TOKENS` (default: `2000`)
- `AI_ALLOWED_ORIGINS` (comma-separated origins; if unset in local dev, `*` is allowed)
- `BLOB_READ_WRITE_TOKEN` (optional; enables persistent `/api/ai/logs` on Vercel)
- `CLERK_API_URL` (default: `https://api.clerk.com`)
- `CLERK_AUDIENCE` (comma-separated allowed `aud` claims, if configured in Clerk)
- `CLERK_AUTHORIZED_PARTIES` (comma-separated allowed `azp` origins, if present in Clerk tokens)
- `CLERK_JWT_KEY` (optional PEM public key for networkless token verification)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (publishable client key reference)

The Android app should use Clerk and send the active Clerk session token as
`Authorization: Bearer <clerk_session_token>` to protected backend endpoints.
Do not ship `CLERK_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in the Android app.

### Sample `.env.example`

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL_CHAT=gpt-5.4-mini
OPENAI_MODEL_PARSE=gpt-5.4-mini
AI_MAX_INPUT_CHARS=6000
AI_MAX_OUTPUT_TOKENS=2000
AI_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
BLOB_READ_WRITE_TOKEN=
CLERK_SECRET_KEY=your_clerk_secret_key_here
CLERK_API_URL=https://api.clerk.com
CLERK_AUDIENCE=
CLERK_AUTHORIZED_PARTIES=
CLERK_JWT_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### Curl examples

Health:

```bash
curl -s http://localhost:3000/api/health | jq
```

Chat:

```bash
curl -s -X POST http://localhost:3000/api/ai/chat \
  -H "content-type: application/json" \
  -d '{
    "message": "Can I still afford groceries this week?",
    "context": {
      "monthKey": "2026-04",
      "currency": "ZAR",
      "recentEvents": [
        {"title":"Rent","amountCents":850000,"dateIso":"2026-04-01","type":"Bill"},
        {"title":"Salary","amountCents":2400000,"dateIso":"2026-04-05","type":"Income"}
      ],
      "projectedEndCents":324000
    },
    "session": {
      "sessionId": "sess_123",
      "deviceId": "android_pixel_8"
    }
  }' | jq
```

Parse:

```bash
curl -s -X POST http://localhost:3000/api/ai/parse \
  -H "content-type: application/json" \
  -d '{
    "input": "rent R8500 on the 15th",
    "monthKey": "2026-04",
    "defaultDateIso": "2026-04-20",
    "currency": "ZAR"
  }' | jq
```

Logs:

```bash
curl -s \"http://localhost:3000/api/ai/logs?limit=20\" | jq
```

Note: logs are kept in memory only and reset on restart/redeploy.
If `BLOB_READ_WRITE_TOKEN` is set, logs are persisted in Vercel Blob and survive restarts/redeploys.

Sync exchange:

```bash
curl -s -X POST http://localhost:3000/sync \
  -H "authorization: Bearer $CLERK_SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "deviceId": "android_pixel_8",
    "since": "2026-04-26T10:00:00.000Z",
    "changes": [
      {
        "entityType": "transaction",
        "operation": "upsert",
        "entityId": "018f1d14-df7e-7c14-a66d-7cf6a2db24be",
        "clientUpdatedAt": "2026-04-26T10:00:00.000Z",
        "payload": {
          "amountCents": 12999,
          "category": "Groceries",
          "description": "Weekly shop",
          "dateIso": "2026-04-26",
          "monthKey": "2026-04",
          "kind": "Expense"
        }
      }
    ]
  }' | jq
```

Example sync response:

```json
{
  "ok": true,
  "requestId": "61d8f72f-9e06-4b50-9d24-0ec8d154ea57",
  "serverTime": "2026-04-26T10:05:00.000Z",
  "latencyMs": 120,
  "accepted": [
    {
      "entityType": "transactions",
      "entityId": "018f1d14-df7e-7c14-a66d-7cf6a2db24be",
      "serverUpdatedAt": "2026-04-26T10:05:00.000Z"
    }
  ],
  "rejected": [],
  "changes": {
    "transactions": [],
    "income": [],
    "budgetCategories": [],
    "plannedSpending": [],
    "upcomingPayments": [],
    "debts": []
  }
}
```

Android offline-first sync notes:
- Add a stable UUID remote ID to every local Room entity. Keep local auto-increment IDs only as local implementation details.
- Track `updatedAt`, `deletedAt`, `syncStatus` or a dirty flag, and the last accepted server timestamp per row.
- Store a user-level `lastPulledAt` cursor from the response `serverTime`; use that value on the next pull/exchange.
- Push upserts and soft deletes as row-level changes. Do not upload a SQLite database file.
- Treat rows with `deletedAt != null` from the server as tombstones and hide or delete them locally after applying the sync.

Supabase schema:
- SQL migrations live in `supabase/migrations`.
- All finance tables use UUID primary keys, explicit Clerk `user_id` values, soft deletes, `updated_at` triggers, enum-like check constraints, RLS policies, and indexes for sync queries.
- The Clerk migration clears old Supabase Auth-owned user data and converts `user_id` columns from Supabase Auth UUIDs to Clerk user ID text values.

### Example success response envelope

```json
{
  "ok": true,
  "requestId": "61d8f72f-9e06-4b50-9d24-0ec8d154ea57",
  "mode": "parse",
  "model": "gpt-5.4-mini",
  "latencyMs": 241,
  "usage": {
    "inputTokens": 223,
    "outputTokens": 91,
    "totalTokens": 314
  },
  "data": {
    "draftAction": {
      "type": "UpcomingBill",
      "amountCents": 850000,
      "category": "Rent",
      "description": "Monthly rent",
      "dateIso": "2026-04-15",
      "monthKey": "2026-04",
      "recurrence": "Monthly"
    },
    "intent": "UpcomingBill",
    "needsReview": true,
    "confidence": 0.79,
    "summary": "Upcoming rent bill on 15th",
    "warnings": [
      "Date was interpreted from day-only input and should be reviewed."
    ]
  }
}
```

### Example error response envelope

```json
{
  "ok": false,
  "requestId": "2039f67d-f25f-4778-ae73-81d9987cb7c8",
  "error": {
    "code": "BAD_REQUEST",
    "message": "Request payload validation failed.",
    "details": {
      "fieldErrors": {
        "monthKey": ["monthKey must be YYYY-MM"]
      }
    }
  }
}
```

### Tests

```bash
npm run test
npm run lint
```

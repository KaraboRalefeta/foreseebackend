import { describe, expect, it } from "vitest";

import { chatRequestSchema, draftActionSchema, parseRequestSchema } from "./schemas";

describe("parseRequestSchema", () => {
  it("accepts a valid parse request", () => {
    const parsed = parseRequestSchema.parse({
      input: "spent R450 on groceries",
      monthKey: "2026-04",
      defaultDateIso: "2026-04-20",
      currency: "zar",
    });

    expect(parsed.currency).toBe("ZAR");
  });

  it("rejects invalid monthKey", () => {
    const result = parseRequestSchema.safeParse({
      input: "spent R450 on groceries",
      monthKey: "2026-13",
    });

    expect(result.success).toBe(false);
  });
});

describe("draftActionSchema", () => {
  it("validates expense contract strictly", () => {
    const result = draftActionSchema.safeParse({
      type: "Expense",
      amountCents: 45000,
      category: "Groceries",
      description: "Supermarket",
      dateIso: "2026-04-20",
      monthKey: "2026-04",
    });

    expect(result.success).toBe(true);
  });

  it("rejects float amount", () => {
    const result = draftActionSchema.safeParse({
      type: "Expense",
      amountCents: 450.5,
      category: "Groceries",
      description: "Supermarket",
      dateIso: "2026-04-20",
      monthKey: "2026-04",
    });

    expect(result.success).toBe(false);
  });
});

describe("chatRequestSchema", () => {
  it("accepts the richer sovereign concierge request shape", () => {
    const parsed = chatRequestSchema.parse({
      message: "How is my spending looking for the rest of the week?",
      requestType: "chat",
      context: {
        monthKey: "2026-04",
        currency: "zar",
        locale: "en-ZA",
        timezone: "Africa/Johannesburg",
        todayIso: "2026-04-22",
        projectedEndCents: 115000,
        safeToSpendCents: 240000,
        availableCashCents: 368000,
        upcomingBills: [
          {
            name: "Rent",
            amountCents: 1240000,
            dueDateIso: "2026-04-25",
            isPaid: false,
            category: "Housing",
          },
        ],
        goalBalances: [
          {
            goalId: "cape-town-trip",
            label: "Cape Town trip fund",
            currentCents: 430000,
            targetCents: 550000,
            gapCents: 120000,
          },
        ],
        categorySnapshots: [
          {
            category: "Food & Dining",
            spentCents: 188000,
            budgetCents: 260000,
            paceVsLastMonthPct: -12,
          },
        ],
        recentEvents: [
          {
            title: "Woolworths",
            amountCents: 42500,
            dateIso: "2026-04-20",
            type: "expense",
            category: "Food & Dining",
          },
        ],
      },
      session: {
        sessionId: "session_123",
        deviceId: "android_device",
        assistantPersona: "sovereign_concierge",
      },
      conversation: [
        { role: "user", content: "I want to plan a trip" },
        { role: "assistant", content: "What date and amount should I reserve?", timestamp: 1776830521000 },
      ],
      pendingIntent: {
        intent: "PlannedSpend",
        missingFields: ["dateIso", "amountCents"],
        draftCandidate: {
          description: "Trip",
          monthKey: "2026-04",
        },
      },
      uiState: {
        screen: "ai_overlay",
        selectedMonthKey: "2026-04",
        selectedDateIso: null,
        draftOpen: false,
      },
      requestMeta: {
        source: "android",
        clientVersion: "1.2.0",
        requestTimeMs: 1776830521000,
      },
    });

    expect(parsed.context?.currency).toBe("ZAR");
    expect(parsed.conversation?.length).toBe(2);
    expect(parsed.pendingIntent?.intent).toBe("PlannedSpend");
    expect(parsed.session?.assistantPersona).toBe("sovereign_concierge");
    expect(parsed.context?.upcomingBills?.[0]?.name).toBe("Rent");
  });
});

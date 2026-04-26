import { describe, expect, it } from "vitest";

import { buildChatPromptPayload } from "./chat-prompt";
import type { ChatRequest } from "./schemas";

const baseContext: NonNullable<ChatRequest["context"]> = {
  monthKey: "2026-04",
  currency: "ZAR",
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
    {
      title: "Tashas",
      amountCents: 86000,
      dateIso: "2026-04-18",
      type: "expense",
      category: "Food & Dining",
    },
  ],
};

describe("buildChatPromptPayload", () => {
  it("builds a forecast-style prompt payload with grounded finance context", () => {
    const payload = buildChatPromptPayload({
      message: "How is my spending looking for the rest of the week? I have dinner on Friday.",
      requestType: "chat",
      context: baseContext,
      conversation: [{ role: "user", content: "How is my spending looking for the rest of the week?" }],
    });

    expect(payload.derivedContext.assistantModeHint).toBe("forecast_answer");
    expect(payload.derivedContext.nextBill?.name).toBe("Rent");
    expect(payload.derivedContext.merchantEstimate?.label).toBe("Dinner budget");
    expect(payload.derivedContext.goalFundingOpportunity?.goalId).toBe("cape-town-trip");
  });

  it("switches to needs-detail mode when an actionable request is missing an amount", () => {
    const payload = buildChatPromptPayload({
      message: "Please plan Friday dinner for me.",
      requestType: "chat",
      context: baseContext,
      pendingIntent: {
        intent: "PlannedSpend",
        missingFields: ["amountCents"],
        draftCandidate: {
          category: "Food & Dining",
          description: "Friday dinner",
        },
      },
    });

    expect(payload.derivedContext.assistantModeHint).toBe("needs_detail");
    expect(payload.derivedContext.pendingIntentSummary.missingFields).toContain("amountCents");
  });

  it("switches to action confirmation mode for a clear yes with a resolved pending intent", () => {
    const payload = buildChatPromptPayload({
      message: "Yes, let's do that.",
      requestType: "chat",
      context: baseContext,
      pendingIntent: {
        intent: "PlannedSpend",
        missingFields: [],
        draftCandidate: {
          amountCents: 50000,
          category: "Travel",
          description: "Cape Town trip fund",
          dateIso: "2026-04-22",
          monthKey: "2026-04",
        },
      },
    });

    expect(payload.derivedContext.assistantModeHint).toBe("action_confirmation");
    expect(payload.derivedContext.confirmationSignal).toBe(true);
  });

  it("switches to warning mode when affordability is tight", () => {
    const payload = buildChatPromptPayload({
      message: "Can I still spend R2,000 this week?",
      requestType: "chat",
      context: {
        ...baseContext,
        safeToSpendCents: 205000,
      },
    });

    expect(payload.derivedContext.assistantModeHint).toBe("warning");
    expect(payload.derivedContext.affordabilityCheck?.status).toBe("tight");
  });
});

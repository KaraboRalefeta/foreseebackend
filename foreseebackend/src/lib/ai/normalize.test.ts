import { describe, expect, it } from "vitest";

import { coerceParseModelOutput, normalizeChatOutput, normalizeParseOutput } from "./normalize";
import type { ChatModelOutput, ParseModelOutput, ParseRequest } from "./schemas";

const baseRequest: ParseRequest = {
  input: "rent R8500 on the 15th",
  monthKey: "2026-04",
  currency: "ZAR",
};

describe("normalizeParseOutput", () => {
  it("normalizes a valid expense draft", () => {
    const modelOutput: ParseModelOutput = {
      intent: "Expense",
      confidence: 0.92,
      summary: "Expense for groceries",
      needsReview: false,
      warnings: [],
      draftAction: {
        type: "Expense",
        amountCents: 45000,
        category: "Groceries",
        description: "Food shopping",
        dateIso: "2026-04-20",
        monthKey: "2026-04",
      },
    };

    const result = normalizeParseOutput(modelOutput, baseRequest);

    expect(result.intent).toBe("Expense");
    expect(result.draftAction?.type).toBe("Expense");
    expect(result.needsReview).toBe(false);
  });

  it("flags ambiguous day-only dates for review", () => {
    const modelOutput: ParseModelOutput = {
      intent: "UpcomingBill",
      confidence: 0.76,
      summary: "Upcoming rent bill",
      draftAction: {
        type: "UpcomingBill",
        amountCents: 850000,
        category: "Rent",
        description: "Monthly rent",
        dateIso: "15",
        monthKey: "2026-04",
        recurrence: "Monthly",
      },
    };

    const result = normalizeParseOutput(modelOutput, baseRequest);

    expect(result.intent).toBe("UpcomingBill");
    expect(result.needsReview).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.draftAction?.dateIso).toBe("2026-04-15");
    expect(result.confidence).toBeLessThanOrEqual(0.79);
  });

  it("returns unknown when draft action is invalid", () => {
    const modelOutput: ParseModelOutput = {
      intent: "Expense",
      summary: "Bad payload",
      draftAction: {
        type: "Expense",
        amountCents: "45000",
      },
    };

    const result = normalizeParseOutput(modelOutput, baseRequest);

    expect(result.intent).toBe("Unknown");
    expect(result.draftAction).toBeNull();
    expect(result.needsReview).toBe(true);
  });

  it("infers split expense from clear phrasing", () => {
    const splitRequest: ParseRequest = {
      input: "I paid R400 for lunch with Sarah",
      monthKey: "2026-04",
      currency: "ZAR",
    };

    const modelOutput: ParseModelOutput = {
      intent: "Expense",
      confidence: 0.95,
      summary: "Expense logged",
      draftAction: {
        type: "Expense",
        amountCents: "bad",
      },
    };

    const result = normalizeParseOutput(modelOutput, splitRequest);

    expect(result.intent).toBe("SplitExpense");
    expect(result.draftAction?.type).toBe("SplitExpense");
    expect(result.draftAction?.personName).toBe("Sarah");
    expect(result.draftAction?.owedCents).toBe(20000);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.79);
  });

  it("normalizes categories and uses better description defaults", () => {
    const request: ParseRequest = {
      input: "spent R450 on groceries",
      monthKey: "2026-04",
      currency: "ZAR",
    };

    const modelOutput: ParseModelOutput = {
      intent: "Expense",
      confidence: 0.9,
      summary: "Expense",
      draftAction: {
        type: "Expense",
        amountCents: 45000,
        category: "groceries",
        description: "",
        dateIso: "2026-04-20",
        monthKey: "2026-04",
      },
    };

    const result = normalizeParseOutput(modelOutput, request);

    expect(result.draftAction?.type).toBe("Expense");
    if (result.draftAction?.type === "Expense") {
      expect(result.draftAction.category).toBe("Food & Dining");
      expect(result.draftAction.description).toBe("Groceries");
    }
  });
});

describe("normalizeChatOutput", () => {
  it("keeps needsReview false when no suggested actions exist", () => {
    const output: ChatModelOutput = {
      status: "needs_detail",
      responseMode: "clarify",
      confidence: 0.62,
      reply: "I cannot confirm affordability yet.",
      uiActions: [
        { id: "open_input_balance", label: "Add info", type: "open_input", target: "currentBalanceCents" },
      ],
      suggestedActions: [],
      needsReview: true,
      missingFields: ["currentBalanceCents"],
      warnings: ["Projected month-end is insufficient for week-level affordability."],
    };

    const result = normalizeChatOutput(output);

    expect(result.needsReview).toBe(false);
    expect(result.status).toBe("needs_detail");
    expect(result.responseMode).toBe("clarify");
    expect(result.pendingIntent?.missingFields).toContain("currentBalanceCents");
  });

  it("does not add dropped-draft warnings when final suggestions are empty", () => {
    const output: ChatModelOutput = {
      reply: "Need more information first.",
      suggestedActions: [
        {
          title: "Broken suggestion",
          reason: "Invalid payload",
          draftAction: { type: "Expense", amountCents: "4000" },
        },
      ],
      warnings: [],
      missingFields: ["upcomingBills"],
      status: "needs_detail",
      confidence: 0.58,
    };

    const result = normalizeChatOutput(output);

    expect(result.suggestedActions).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.status).toBe("needs_detail");
  });

  it("returns create_draft action with payload when draft is ready", () => {
    const output: ChatModelOutput = {
      status: "draft_creation",
      responseMode: "propose_action",
      confidence: 0.91,
      reply: "Would you like me to create it as a planned spend draft?",
      suggestedActions: [
        {
          title: "Create planned spend",
          reason: "User requested planned trip budget",
          draftAction: {
            type: "PlannedSpend",
            amountCents: 200000,
            category: "Travel",
            description: "Trip",
            dateIso: "2026-04-25",
            monthKey: "2026-04",
          },
        },
      ],
      missingFields: [],
      warnings: [],
    };

    const result = normalizeChatOutput(output);

    expect(result.uiActions).toHaveLength(1);
    expect(result.uiActions[0].type).toBe("create_draft");
    expect(result.status).toBe("draft_creation");
    expect(result.responseMode).toBe("propose_action");
    if (result.uiActions[0].type === "create_draft") {
      expect(result.uiActions[0].label).toBe("Review planned spend");
      expect(result.uiActions[0].draftType).toBe("PlannedSpend");
      expect(result.uiActions[0].draftPayload).toMatchObject({
        amountCents: 200000,
        category: "Travel",
        description: "Trip",
        dateIso: "2026-04-25",
        monthKey: "2026-04",
      });
    }
    expect(result.primaryCta?.label).toBe("Review planned spend");
  });

  it("returns open_input actions when essential fields are missing", () => {
    const output: ChatModelOutput = {
      status: "needs_detail",
      confidence: 0.55,
      reply: "I need more info first.",
      suggestedActions: [],
      missingFields: ["amountCents"],
      warnings: [],
    };

    const result = normalizeChatOutput(output);

    expect(result.uiActions.every((a) => a.type === "open_input")).toBe(true);
    expect(result.uiActions.length).toBe(1);
    expect(result.status).toBe("needs_detail");
    expect(result.responseMode).toBe("clarify");
    expect(result.uiActions[0]?.label).toBe("Add amount");
    expect(result.pendingIntent?.missingFields).toContain("amountCents");
  });

  it("creates draft action from model pendingIntent candidate when suggestedActions are empty", () => {
    const output: ChatModelOutput = {
      status: "draft_creation",
      confidence: 0.98,
      reply:
        "Yes — based on the affordability check, the trip looks affordable. If you want, I can draft it.",
      uiActions: [],
      suggestedActions: [],
      needsReview: false,
      missingFields: [],
      warnings: [],
      pendingIntent: {
        intent: "PlannedSpend",
        missingFields: [],
        draftCandidate: {
          title: "Gold reef city trip",
          amountCents: 200000,
          currency: "ZAR",
          dateIso: "2026-05-01",
          notes: "Trip to Gold Reef City next Friday",
        },
      },
    };

    const result = normalizeChatOutput(output, {
      message:
        "I want to go on a trip to gold reef city next week friday and i'll probably spend about 2k there",
      context: {
        monthKey: "2026-04",
        currency: "ZAR",
        projectedEndCents: 324000,
      },
    });

    expect(result.uiActions).toHaveLength(1);
    expect(result.status).toBe("draft_creation");
    expect(result.responseMode).toBe("propose_action");
    expect(result.uiActions[0].type).toBe("create_draft");
    if (result.uiActions[0].type === "create_draft") {
      expect(result.uiActions[0].draftType).toBe("PlannedSpend");
      expect(result.uiActions[0].target).toBe("planned_spend");
      expect(result.uiActions[0].draftPayload).toMatchObject({
        amountCents: 200000,
        dateIso: "2026-05-01",
      });
    }
  });

  it("infers planned spend draft from trip intent when model returns no actions", () => {
    const output: ChatModelOutput = {
      status: "briefing",
      confidence: 0.96,
      reply: "This looks affordable. I can draft it.",
      uiActions: [],
      suggestedActions: [],
      needsReview: false,
      missingFields: [],
      warnings: [],
      pendingIntent: null,
    };

    const result = normalizeChatOutput(output, {
      message:
        "I want to go on a trip to gold reef city next week friday and i'll probably spend about 2k there",
      context: {
        monthKey: "2026-04",
        currency: "ZAR",
        projectedEndCents: 324000,
      },
      pendingIntent: null,
      conversation: [
        {
          role: "user",
          content:
            "I want to go on a trip to gold reef city next week friday and i'll probably spend about 2k there",
        },
      ],
    });

    expect(result.uiActions).toHaveLength(1);
    expect(result.status).toBe("draft_creation");
    expect(result.responseMode).toBe("propose_action");
    expect(result.uiActions[0].type).toBe("create_draft");
    if (result.uiActions[0].type === "create_draft") {
      expect(result.uiActions[0].draftType).toBe("PlannedSpend");
      expect(result.uiActions[0].draftPayload).toMatchObject({
        amountCents: 200000,
      });
    }
  });

  it("preserves premium briefing fields when the model returns them", () => {
    const output: ChatModelOutput = {
      status: "briefing",
      responseMode: "propose_action",
      confidence: 0.92,
      tone: "calm_premium",
      reply:
        "Based on your current trajectory, you have R2,400 of safe-to-spend room before your next bill.",
      insightLabel: "Trajectory Analysis",
      headline: "You have R2,400 of safe-to-spend room before your next bill.",
      supportingBody: "Food and dining is tracking 12% below last month.",
      advisorNote: "Treat the dinner estimate as a guide rather than a ceiling.",
      safeToSpendCents: 240000,
      projectedSurplusCents: 115000,
      metricCards: [
        {
          id: "projected_surplus",
          label: "Projected Surplus",
          valueText: "R1,150.00",
          valueCents: 115000,
          tone: "positive",
        },
      ],
      recommendationCard: {
        eyebrow: "Vault Suggestion",
        title: "Your Cape Town trip fund is R1,200 short of target.",
        body: "Would you like me to set aside R500 from this week's surplus?",
        emphasisAmountText: "R500",
      },
      primaryCta: {
        id: "set_aside_trip_500",
        label: "Yes, transfer R500",
        type: "create_draft",
        target: "goal_transfer",
        intent: "transfer_to_goal",
      },
      secondaryCta: {
        id: "maybe_later",
        label: "Maybe later",
        type: "dismiss_recommendation",
        target: "recommendation_card",
        intent: "dismiss_recommendation",
      },
      warnings: [],
      missingFields: [],
    };

    const result = normalizeChatOutput(output, {
      message: "Can I afford dinner this week?",
      context: {
        monthKey: "2026-04",
        currency: "ZAR",
        locale: "en-ZA",
        safeToSpendCents: 240000,
        projectedEndCents: 115000,
      },
    });

    expect(result.status).toBe("briefing");
    expect(result.responseMode).toBe("propose_action");
    expect(result.metricCards[0]?.label).toBe("Projected Surplus");
    expect(result.recommendationCard?.eyebrow).toBe("Vault Suggestion");
    expect(result.primaryCta?.intent).toBe("transfer_to_goal");
    expect(result.secondaryCta?.type).toBe("dismiss_recommendation");
  });
});

describe("coerceParseModelOutput", () => {
  it("soft-coerces malformed output into safe parse model output", () => {
    const coerced = coerceParseModelOutput(
      {
        summary: 1234,
        confidence: "0.95",
        warnings: ["schema drift"],
      },
      {
        input: "I paid R400 for lunch with Sarah",
        monthKey: "2026-04",
        currency: "ZAR",
      },
    );

    expect(coerced.intent).toBe("SplitExpense");
    expect(coerced.needsReview).toBe(true);
    expect(coerced.confidence).toBeLessThanOrEqual(1);
    expect(coerced.summary).toContain("I could not fully parse");
    expect(coerced.warnings?.some((w) => w.includes("soft-parse fallback"))).toBe(true);
  });
});

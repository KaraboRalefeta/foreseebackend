import { describe, expect, it } from "vitest";

import { deterministicResolve } from "./context-resolver";
import { contextResolverOutputSchema } from "./schemas";

const pendingIntent = {
  intent: "PlannedSpend" as const,
  missingFields: [],
  draftCandidate: {
    amountCents: 70000,
    category: "Transportation",
    description: "Transport",
    dateIso: "2026-04-29",
    monthKey: "2026-04",
  },
};

const context = {
  monthKey: "2026-04",
  todayIso: "2026-04-29",
  currency: "ZAR",
};

describe("context resolver", () => {
  it("schema accepts every supported classification", () => {
    const classifications = [
      "AskQuestion",
      "AffordabilityCheck",
      "CreateExpense",
      "CreateIncome",
      "CreatePlannedSpend",
      "CreateUpcomingBill",
      "CreateSplitExpense",
      "CreateDebtRepayment",
      "ConfirmPendingAction",
      "RejectPendingAction",
      "ModifyPendingAction",
      "HesitateOnPendingAction",
      "MissingDetailAnswer",
      "GeneralFinanceAdvice",
      "Unknown",
    ];

    for (const classification of classifications) {
      expect(() =>
        contextResolverOutputSchema.parse({
          classification,
          confidence: 0.8,
        }),
      ).not.toThrow();
    }
  });

  it("classifies yes as confirming a resolved pending intent", () => {
    const result = deterministicResolve({
      message: "yes",
      pendingIntent,
      conversation: [],
      context,
      uiState: undefined,
    });

    expect(result.classification).toBe("ConfirmPendingAction");
    expect(result.shouldCreateDraft).toBe(true);
  });

  it("classifies maybe as hesitation and avoids draft creation", () => {
    const result = deterministicResolve({
      message: "maybe",
      pendingIntent,
      conversation: [],
      context,
      uiState: undefined,
    });

    expect(result.classification).toBe("HesitateOnPendingAction");
    expect(result.shouldCreateDraft).toBe(false);
  });

  it("extracts amount changes for pending intent modifications", () => {
    const result = deterministicResolve({
      message: "Make it R500",
      pendingIntent,
      conversation: [],
      context,
      uiState: undefined,
    });

    expect(result.classification).toBe("ModifyPendingAction");
    expect(result.fieldUpdates?.amountCents).toBe(50000);
  });

  it("treats a bare amount as the answer to a missing detail", () => {
    const result = deterministicResolve({
      message: "R450",
      pendingIntent: {
        ...pendingIntent,
        missingFields: ["amountCents"],
        draftCandidate: {
          category: "Groceries",
          description: "Groceries",
          dateIso: "2026-04-29",
          monthKey: "2026-04",
        },
      },
      conversation: [],
      context,
      uiState: undefined,
    });

    expect(result.classification).toBe("MissingDetailAnswer");
    expect(result.fieldUpdates?.amountCents).toBe(45000);
    expect(result.shouldCreateDraft).toBe(true);
  });

  it("resolves affordability checks against the pending amount", () => {
    const result = deterministicResolve({
      message: "Can I afford it?",
      pendingIntent,
      conversation: [],
      context,
      uiState: undefined,
    });

    expect(result.classification).toBe("AffordabilityCheck");
    expect(result.requestedAmountCents).toBe(70000);
    expect(result.shouldRunAffordabilityCheck).toBe(true);
  });
});

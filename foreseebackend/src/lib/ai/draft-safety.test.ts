import { describe, expect, it } from "vitest";

import { enforceDraftSafety, mergePendingIntent, validateDraftCandidate } from "./draft-safety";
import type { ChatData, ContextResolverOutput } from "./schemas";

const baseData: ChatData = {
  status: "draft_creation",
  responseMode: "propose_action",
  confidence: 0.88,
  tone: "calm_premium",
  reply: "Ready for review.",
  insightLabel: "Next Step",
  trajectoryLabel: null,
  headline: null,
  supportingBody: null,
  advisorNote: null,
  safeToSpendCents: null,
  projectedSurplusCents: null,
  nextBill: null,
  metricCards: [],
  merchantContext: null,
  coachPrompt: null,
  recommendationCard: null,
  primaryCta: {
    id: "unsafe",
    label: "Save now",
    type: "create_draft",
  },
  secondaryCta: null,
  uiActions: [
    {
      id: "unsafe",
      label: "Save now",
      type: "create_draft",
      target: "expense",
      intent: "create_expense",
      draftType: "Expense",
      draftPayload: {
        amountCents: 1,
        category: "Bad",
        description: "Bad",
        dateIso: "2026-04-29",
        monthKey: "2026-04",
      },
    },
  ],
  suggestedActions: [],
  needsReview: true,
  missingFields: [],
  pendingIntent: null,
  assumptions: [],
  warnings: [],
  completionState: null,
};

const confirmResolver: ContextResolverOutput = {
  classification: "ConfirmPendingAction",
  refersToPendingIntent: true,
  resolvedIntent: "PlannedSpend",
  shouldCreateDraft: true,
  missingFields: [],
  fieldUpdates: {},
  confidence: 0.95,
};

describe("draft safety", () => {
  it("blocks draft creation when required fields are missing", () => {
    const result = validateDraftCandidate({
      intent: "Expense",
      missingFields: [],
      draftCandidate: {
        category: "Groceries",
        description: "Groceries",
        dateIso: "2026-04-29",
        monthKey: "2026-04",
      },
    });

    expect(result.draftAction).toBeNull();
    expect(result.missingFields).toContain("amountCents");
  });

  it("replaces unsafe model draft payloads with backend-canonical payloads", () => {
    const result = enforceDraftSafety({
      data: baseData,
      resolver: confirmResolver,
      pendingIntent: {
        intent: "PlannedSpend",
        missingFields: [],
        draftCandidate: {
          amountCents: 70000,
          category: "Transportation",
          description: "Transport",
          dateIso: "2026-04-29",
          monthKey: "2026-04",
        },
      },
    });

    expect(result.status).toBe("draft_creation");
    expect(result.uiActions[0]?.type).toBe("create_draft");
    if (result.uiActions[0]?.type === "create_draft") {
      expect(result.uiActions[0].draftType).toBe("PlannedSpend");
      expect(result.uiActions[0].draftPayload).toMatchObject({
        amountCents: 70000,
        category: "Transportation",
      });
    }
  });

  it("keeps hesitation pending while stripping create_draft actions", () => {
    const result = enforceDraftSafety({
      data: baseData,
      resolver: {
        ...confirmResolver,
        classification: "HesitateOnPendingAction",
        shouldCreateDraft: false,
      },
      pendingIntent: {
        intent: "PlannedSpend",
        missingFields: [],
        draftCandidate: {
          amountCents: 70000,
          category: "Transportation",
          description: "Transport",
          dateIso: "2026-04-29",
          monthKey: "2026-04",
        },
      },
    });

    expect(result.needsReview).toBe(false);
    expect(result.uiActions).toHaveLength(0);
    expect(result.pendingIntent?.intent).toBe("PlannedSpend");
  });

  it("merges resolver field updates into pending intent", () => {
    const result = mergePendingIntent(
      {
        intent: "PlannedSpend",
        missingFields: [],
        draftCandidate: {
          amountCents: 70000,
          category: "Transportation",
          description: "Transport",
          dateIso: "2026-04-29",
          monthKey: "2026-04",
        },
      },
      {
        classification: "ModifyPendingAction",
        refersToPendingIntent: true,
        resolvedIntent: "PlannedSpend",
        fieldUpdates: { amountCents: 50000 },
        shouldCreateDraft: false,
        confidence: 0.95,
      },
      {
        monthKey: "2026-04",
        todayIso: "2026-04-29",
      },
    );

    expect(result?.draftCandidate.amountCents).toBe(50000);
  });
});

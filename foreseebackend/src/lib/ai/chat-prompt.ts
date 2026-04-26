import { computeAffordability } from "@/lib/ai/affordability";
import type { ChatRequest } from "@/lib/ai/schemas";

type AssistantModeHint =
  | "forecast_answer"
  | "needs_detail"
  | "warning"
  | "action_confirmation"
  | "draft_creation";

function isIsoDate(value: string | undefined | null): value is string {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function looksLikeConfirmation(message: string): boolean {
  const compact = message.trim().toLowerCase();
  return /^(yes|yep|yeah|ok|okay|sure|confirm|please do|do it|go ahead|sounds good|let's do that|lets do that)\b/.test(
    compact,
  );
}

function inferTopic(message: string): {
  category?: string;
  label?: string;
  explanation?: string;
} {
  const lowered = message.toLowerCase();

  if (/\b(dinner|lunch|restaurant|takeaway|meal|grocer|grocery|food)\b/.test(lowered)) {
    return {
      category: "Food & Dining",
      label: "Dinner budget",
      explanation: "Estimated from your recent dining history.",
    };
  }

  if (/\b(uber|taxi|transport|bus|train|fuel|petrol)\b/.test(lowered)) {
    return {
      category: "Transportation",
      label: "Transport guide",
      explanation: "Estimated from your recent transport history.",
    };
  }

  if (/\b(trip|travel|flight|hotel|holiday|vacation)\b/.test(lowered)) {
    return {
      category: "Travel",
      label: "Travel estimate",
      explanation: "Estimated from your planned travel context.",
    };
  }

  return {};
}

function deriveTrajectoryLabel(context: ChatRequest["context"]): string | null {
  if (!context) {
    return null;
  }

  const safeRoom = context.safeToSpendCents ?? context.budgetSafeRoomCents;
  if (typeof safeRoom === "number") {
    if (safeRoom < 0) {
      return "Pressure building";
    }
    if (safeRoom > 0) {
      return "Room intact";
    }
  }

  const snapshots = context.categorySnapshots ?? [];
  const notableRise = snapshots.find((snapshot) => snapshot.paceVsLastMonthPct >= 10);
  if (notableRise) {
    return "Pace rising";
  }

  const notableEase = snapshots.find((snapshot) => snapshot.paceVsLastMonthPct <= -10);
  if (notableEase) {
    return "Ahead of pace";
  }

  if (typeof context.projectedEndCents === "number") {
    return context.projectedEndCents >= 0 ? "Steady trajectory" : "Deficit watch";
  }

  return null;
}

function selectNextBill(
  context: ChatRequest["context"],
): NonNullable<NonNullable<ChatRequest["context"]>["upcomingBills"]>[number] | null {
  const bills = (context?.upcomingBills ?? []).filter((bill) => bill.isPaid !== true);
  if (bills.length === 0) {
    return null;
  }

  const anchorDate = isIsoDate(context?.todayIso) ? context?.todayIso : todayIso();
  const sorted = [...bills].sort((left, right) => {
    const leftOverdue = left.dueDateIso < anchorDate ? 0 : 1;
    const rightOverdue = right.dueDateIso < anchorDate ? 0 : 1;

    if (leftOverdue !== rightOverdue) {
      return leftOverdue - rightOverdue;
    }

    return left.dueDateIso.localeCompare(right.dueDateIso);
  });

  return sorted[0] ?? null;
}

function deriveCategoryTrendHighlights(
  context: ChatRequest["context"],
): Array<{
  category: string;
  spentCents: number;
  budgetCents: number;
  paceVsLastMonthPct: number;
  direction: "ahead" | "behind" | "flat";
}> {
  return (context?.categorySnapshots ?? [])
    .map((snapshot) => ({
      category: snapshot.category,
      spentCents: snapshot.spentCents,
      budgetCents: snapshot.budgetCents,
      paceVsLastMonthPct: snapshot.paceVsLastMonthPct,
      direction:
        snapshot.paceVsLastMonthPct <= -5
          ? ("ahead" as const)
          : snapshot.paceVsLastMonthPct >= 5
            ? ("behind" as const)
            : ("flat" as const),
    }))
    .sort((left, right) => Math.abs(right.paceVsLastMonthPct) - Math.abs(left.paceVsLastMonthPct))
    .slice(0, 3);
}

function deriveGoalFundingOpportunity(
  context: ChatRequest["context"],
): {
  goalId: string;
  label: string;
  gapCents: number;
  suggestedSetAsideCents: number;
} | null {
  const safeRoom = context?.safeToSpendCents ?? context?.budgetSafeRoomCents;
  if (typeof safeRoom !== "number" || safeRoom <= 0) {
    return null;
  }

  const goals = (context?.goalBalances ?? [])
    .map((goal) => ({
      goalId: goal.goalId,
      label: goal.label,
      gapCents: goal.gapCents ?? Math.max(goal.targetCents - goal.currentCents, 0),
    }))
    .filter((goal) => goal.gapCents > 0)
    .sort((left, right) => left.gapCents - right.gapCents);

  const chosen = goals[0];
  if (!chosen) {
    return null;
  }

  const rawSuggestion = Math.min(chosen.gapCents, Math.max(25000, Math.min(safeRoom / 4, 100000)));
  const suggestedSetAsideCents = Math.max(5000, Math.floor(rawSuggestion / 5000) * 5000);

  return {
    goalId: chosen.goalId,
    label: chosen.label,
    gapCents: chosen.gapCents,
    suggestedSetAsideCents,
  };
}

function deriveMerchantEstimate(
  message: string,
  context: ChatRequest["context"],
): {
  kind: "habit_estimate";
  label: string;
  estimatedAmountCents: number;
  explanation: string;
} | null {
  const topic = inferTopic(message);
  if (!topic.category || !topic.label || !topic.explanation) {
    return null;
  }
  const category = topic.category.toLowerCase();
  const categoryToken = category.split(" ")[0];

  const matchingEvents = (context?.recentEvents ?? []).filter((event) => {
    const categoryMatch = event.category?.toLowerCase() === category;
    const titleMatch = event.title.toLowerCase().includes(categoryToken);
    return categoryMatch || titleMatch;
  });

  if (matchingEvents.length === 0) {
    return null;
  }

  const estimatedAmountCents = Math.round(
    matchingEvents.reduce((sum, event) => sum + event.amountCents, 0) / matchingEvents.length,
  );

  return {
    kind: "habit_estimate",
    label: topic.label,
    estimatedAmountCents,
    explanation: topic.explanation,
  };
}

function classifyAssistantMode(
  payload: ChatRequest,
  affordability: ReturnType<typeof computeAffordability>,
): AssistantModeHint {
  const confirmation = looksLikeConfirmation(payload.message);
  const hasPendingIntent = Boolean(payload.pendingIntent && payload.pendingIntent.intent !== "Unknown");
  const missingPendingFields = payload.pendingIntent?.missingFields ?? [];
  const requestLooksActionable = /\b(plan|set aside|reserve|transfer|move|create|draft|track|add)\b/i.test(
    payload.message,
  );
  const requestLooksForecast = /\b(afford|spending|trajectory|rest of the week|week|month|looking)\b/i.test(
    payload.message,
  );

  if (confirmation && hasPendingIntent && missingPendingFields.length === 0) {
    return "action_confirmation";
  }

  if (affordability.affordabilityCheck?.status === "tight" || affordability.affordabilityCheck?.status === "not_affordable") {
    return "warning";
  }

  if (
    (requestLooksActionable || hasPendingIntent) &&
    (missingPendingFields.length > 0 || affordability.missingFields.includes("requestedAmountCents"))
  ) {
    return "needs_detail";
  }

  if (requestLooksActionable || hasPendingIntent) {
    return "draft_creation";
  }

  if (requestLooksForecast) {
    return "forecast_answer";
  }

  return affordability.missingFields.length > 0 ? "needs_detail" : "forecast_answer";
}

export function buildChatPromptPayload(payload: ChatRequest) {
  const affordability = computeAffordability({
    message: payload.message,
    context: payload.context,
  });
  const nextBill = selectNextBill(payload.context);
  const merchantEstimate = deriveMerchantEstimate(payload.message, payload.context);
  const goalFundingOpportunity = deriveGoalFundingOpportunity(payload.context);

  return {
    task: "Compose a Sovereign Concierge finance briefing.",
    assistantPersona: payload.session?.assistantPersona ?? "sovereign_concierge",
    requestType: payload.requestType ?? "chat",
    message: payload.message,
    session: {
      sessionId: payload.session?.sessionId ?? null,
      deviceId: payload.session?.deviceId ?? null,
    },
    uiState: payload.uiState ?? null,
    context: {
      monthKey: payload.context?.monthKey ?? null,
      currency: payload.context?.currency ?? "ZAR",
      locale: payload.context?.locale ?? "en-ZA",
      timezone: payload.context?.timezone ?? "Africa/Johannesburg",
      todayIso: payload.context?.todayIso ?? todayIso(),
      projectedEndCents: payload.context?.projectedEndCents ?? null,
      safeToSpendCents: payload.context?.safeToSpendCents ?? payload.context?.budgetSafeRoomCents ?? null,
      availableCashCents: payload.context?.availableCashCents ?? null,
      incomeExpectedCents: payload.context?.incomeExpectedCents ?? null,
      incomeReceivedCents: payload.context?.incomeReceivedCents ?? null,
      totalBudgetLimitCents: payload.context?.totalBudgetLimitCents ?? null,
      budgetSafeRoomCents: payload.context?.budgetSafeRoomCents ?? null,
      upcomingBills: payload.context?.upcomingBills ?? [],
      goalBalances: payload.context?.goalBalances ?? [],
      categorySnapshots: payload.context?.categorySnapshots ?? [],
      recentEvents: payload.context?.recentEvents ?? [],
    },
    derivedContext: {
      assistantModeHint: classifyAssistantMode(payload, affordability),
      confirmationSignal: looksLikeConfirmation(payload.message),
      affordabilityCheck: affordability.affordabilityCheck,
      affordabilityInputsMissing: affordability.missingFields,
      trajectoryLabel: deriveTrajectoryLabel(payload.context),
      projectedSurplusCents: payload.context?.projectedEndCents ?? null,
      safeToSpendCents: payload.context?.safeToSpendCents ?? payload.context?.budgetSafeRoomCents ?? null,
      nextBill,
      categoryTrendHighlights: deriveCategoryTrendHighlights(payload.context),
      goalFundingOpportunity,
      merchantEstimate,
      pendingIntentSummary: {
        hasPendingIntent: Boolean(payload.pendingIntent),
        intent: payload.pendingIntent?.intent ?? null,
        missingFields: payload.pendingIntent?.missingFields ?? [],
      },
    },
    conversation: payload.conversation ?? [],
    pendingIntent: payload.pendingIntent ?? null,
  };
}

export function buildChatPromptInput(payload: ChatRequest): string {
  return JSON.stringify(buildChatPromptPayload(payload), null, 2);
}

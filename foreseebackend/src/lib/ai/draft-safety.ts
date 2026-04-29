import {
  chatDataSchema,
  draftActionSchema,
  type ChatData,
  type ContextResolverOutput,
  type DraftAction,
  type Intent,
} from "@/lib/ai/schemas";

export type PendingIntent = {
  intent: Intent;
  missingFields: string[];
  draftCandidate: Record<string, unknown>;
};

export type DraftValidationResult = {
  draftAction: DraftAction | null;
  missingFields: string[];
};

const CREATE_INTENT_BY_CLASSIFICATION: Partial<Record<ContextResolverOutput["classification"], Intent>> = {
  CreateExpense: "Expense",
  CreateIncome: "Income",
  CreatePlannedSpend: "PlannedSpend",
  CreateUpcomingBill: "UpcomingBill",
  CreateSplitExpense: "SplitExpense",
  CreateDebtRepayment: "DebtRepayment",
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asCents(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);
}

function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function intentFromResolver(resolver: ContextResolverOutput): Intent {
  return (
    resolver.resolvedIntent ??
    CREATE_INTENT_BY_CLASSIFICATION[resolver.classification] ??
    "Unknown"
  );
}

export function mergePendingIntent(
  existing: PendingIntent | null | undefined,
  resolver: ContextResolverOutput,
  defaults: { monthKey: string; todayIso: string },
): PendingIntent | null {
  if (resolver.classification === "RejectPendingAction") {
    return null;
  }

  const intent = intentFromResolver(resolver);
  const shouldKeep =
    resolver.refersToPendingIntent ||
    resolver.shouldAskForDetail ||
    resolver.shouldCreateDraft ||
    resolver.classification === "HesitateOnPendingAction" ||
    resolver.classification === "ModifyPendingAction" ||
    resolver.classification === "MissingDetailAnswer" ||
    intent !== "Unknown";

  if (!shouldKeep) {
    return existing ?? null;
  }

  const draftCandidate = {
    ...(existing?.draftCandidate ?? {}),
    ...(resolver.resolvedDraftCandidate ?? {}),
    ...(resolver.fieldUpdates ?? {}),
  };

  if (!draftCandidate.monthKey) {
    draftCandidate.monthKey = defaults.monthKey;
  }

  if (!draftCandidate.dateIso && intent !== "Income") {
    draftCandidate.dateIso = defaults.todayIso;
  }

  const pending: PendingIntent = {
    intent: intent !== "Unknown" ? intent : (existing?.intent ?? "Unknown"),
    missingFields: [],
    draftCandidate,
  };
  pending.missingFields = validateDraftCandidate(pending).missingFields;

  return pending;
}

function descriptionFromCandidate(candidate: Record<string, unknown>): string | null {
  return (
    asText(candidate.description) ??
    asText(candidate.title) ??
    asText(candidate.name) ??
    asText(candidate.category) ??
    asText(candidate.source)
  );
}

export function validateDraftCandidate(pending: PendingIntent | null | undefined): DraftValidationResult {
  if (!pending || pending.intent === "Unknown") {
    return { draftAction: null, missingFields: [] };
  }

  const candidate = pending.draftCandidate ?? {};
  const amountCents = asCents(candidate.amountCents);
  const monthKey = isMonthKey(candidate.monthKey) ? candidate.monthKey : null;
  const dateIso = isIsoDate(candidate.dateIso) ? candidate.dateIso : null;
  const description = descriptionFromCandidate(candidate);
  const category = asText(candidate.category);

  const missing = new Set<string>();
  if (amountCents === null) missing.add("amountCents");
  if (!monthKey) missing.add("monthKey");

  switch (pending.intent) {
    case "Expense":
    case "PlannedSpend": {
      if (!category) missing.add("category");
      if (!description) missing.add("description");
      if (!dateIso) missing.add("dateIso");
      if (missing.size > 0 || amountCents === null || !monthKey || !dateIso || !category || !description) {
        return { draftAction: null, missingFields: [...missing] };
      }

      return {
        draftAction: {
          type: pending.intent,
          amountCents,
          category,
          description,
          dateIso,
          monthKey,
        },
        missingFields: [],
      };
    }
    case "Income": {
      const source = asText(candidate.source) ?? description;
      if (!source) missing.add("source");
      if (!dateIso) missing.add("dateIso");
      if (missing.size > 0 || amountCents === null || !monthKey || !dateIso || !source) {
        return { draftAction: null, missingFields: [...missing] };
      }

      return {
        draftAction: {
          type: "Income",
          amountCents,
          source,
          dateIso,
          monthKey,
        },
        missingFields: [],
      };
    }
    case "UpcomingBill": {
      if (!category) missing.add("category");
      if (!description) missing.add("description");
      if (!dateIso) missing.add("dateIso");
      if (missing.size > 0 || amountCents === null || !monthKey || !dateIso || !category || !description) {
        return { draftAction: null, missingFields: [...missing] };
      }
      const recurrence = asText(candidate.recurrence);

      return {
        draftAction: {
          type: "UpcomingBill",
          amountCents,
          category,
          description,
          dateIso,
          monthKey,
          recurrence:
            recurrence === "Weekly" || recurrence === "Monthly" || recurrence === "None"
              ? recurrence
              : "None",
        },
        missingFields: [],
      };
    }
    case "SplitExpense": {
      const personName = asText(candidate.personName) ?? asText(candidate.personOrAccount);
      if (!category) missing.add("category");
      if (!description) missing.add("description");
      if (!dateIso) missing.add("dateIso");
      if (!personName) missing.add("personName");
      if (missing.size > 0 || amountCents === null || !monthKey || !dateIso || !category || !description || !personName) {
        return { draftAction: null, missingFields: [...missing] };
      }

      return {
        draftAction: {
          type: "SplitExpense",
          amountCents,
          category,
          description,
          dateIso,
          monthKey,
          personName,
          owedCents: asCents(candidate.owedCents) ?? Math.round(amountCents / 2),
        },
        missingFields: [],
      };
    }
    case "DebtRepayment": {
      const personName = asText(candidate.personName) ?? asText(candidate.personOrAccount);
      if (!dateIso) missing.add("dateIso");
      if (!personName) missing.add("personName");
      if (missing.size > 0 || amountCents === null || !monthKey || !dateIso || !personName) {
        return { draftAction: null, missingFields: [...missing] };
      }

      return {
        draftAction: {
          type: "DebtRepayment",
          amountCents,
          personName,
          dateIso,
          monthKey,
        },
        missingFields: [],
      };
    }
  }
}

function draftPayload(draft: DraftAction): Record<string, unknown> {
  switch (draft.type) {
    case "Expense":
      return {
        amountCents: draft.amountCents,
        category: draft.category,
        description: draft.description,
        dateIso: draft.dateIso,
        monthKey: draft.monthKey,
      };
    case "Income":
      return {
        amountCents: draft.amountCents,
        source: draft.source,
        dateIso: draft.dateIso,
        monthKey: draft.monthKey,
      };
    case "PlannedSpend":
      return {
        amountCents: draft.amountCents,
        category: draft.category,
        description: draft.description,
        dateIso: draft.dateIso,
        monthKey: draft.monthKey,
      };
    case "UpcomingBill":
      return {
        amountCents: draft.amountCents,
        category: draft.category,
        description: draft.description,
        dateIso: draft.dateIso,
        monthKey: draft.monthKey,
        recurrence: draft.recurrence,
      };
    case "SplitExpense":
      return {
        amountCents: draft.amountCents,
        category: draft.category,
        description: draft.description,
        dateIso: draft.dateIso,
        monthKey: draft.monthKey,
        personName: draft.personName,
        owedCents: draft.owedCents,
      };
    case "DebtRepayment":
      return {
        amountCents: draft.amountCents,
        personName: draft.personName,
        dateIso: draft.dateIso,
        monthKey: draft.monthKey,
      };
  }
}

function draftTarget(type: DraftAction["type"]): string {
  switch (type) {
    case "Expense":
      return "expense";
    case "Income":
      return "income";
    case "PlannedSpend":
      return "planned_spend";
    case "UpcomingBill":
      return "upcoming_bill";
    case "SplitExpense":
      return "split_expense";
    case "DebtRepayment":
      return "debt_repayment";
  }
}

function draftIntent(type: DraftAction["type"]): string {
  return `create_${draftTarget(type)}`;
}

function draftLabel(type: DraftAction["type"]): string {
  switch (type) {
    case "Expense":
      return "Review expense";
    case "Income":
      return "Review income";
    case "PlannedSpend":
      return "Review planned spend";
    case "UpcomingBill":
      return "Review bill";
    case "SplitExpense":
      return "Review split";
    case "DebtRepayment":
      return "Review repayment";
  }
}

export function createDraftUiAction(draft: DraftAction) {
  const target = draftTarget(draft.type);
  return {
    id: `review_${target}`,
    label: draftLabel(draft.type),
    type: "create_draft" as const,
    target,
    intent: draftIntent(draft.type),
    draftType: draft.type,
    draftPayload: draftPayload(draft),
  };
}

function openInputAction(field: string) {
  const normalized = field.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const label =
    field === "amountCents"
      ? "Enter amount"
      : field === "dateIso"
        ? "Enter date"
        : `Enter ${titleCase(field.replace(/Cents$/, ""))}`;
  return {
    id: `enter_${normalized}`,
    label,
    type: "open_input" as const,
    target: field,
    intent:
      field === "amountCents"
        ? "ask_for_missing_amount"
        : field === "dateIso"
          ? "ask_for_missing_date"
          : "ask_for_missing_detail",
  };
}

export function enforceDraftSafety(params: {
  data: ChatData;
  resolver: ContextResolverOutput;
  pendingIntent: PendingIntent | null;
}): ChatData {
  const { data, resolver, pendingIntent } = params;
  const validation = validateDraftCandidate(pendingIntent);
  const rejectOrHesitate =
    resolver.classification === "RejectPendingAction" ||
    resolver.classification === "HesitateOnPendingAction";

  if (rejectOrHesitate) {
    return chatDataSchema.parse({
      ...data,
      status: data.status === "completed" ? "completed" : "briefing",
      responseMode: data.status === "completed" ? "completed" : "briefing",
      uiActions: data.uiActions.filter((action) => action.type !== "create_draft"),
      primaryCta: data.primaryCta?.type === "create_draft" ? null : data.primaryCta,
      secondaryCta: data.secondaryCta?.type === "create_draft" ? null : data.secondaryCta,
      needsReview: false,
      pendingIntent,
    });
  }

  if (validation.missingFields.length > 0) {
    const action = openInputAction(validation.missingFields[0]);
    return chatDataSchema.parse({
      ...data,
      status: "needs_detail",
      responseMode: "clarify",
      uiActions: [action],
      primaryCta: action,
      secondaryCta: null,
      needsReview: false,
      missingFields: validation.missingFields,
      pendingIntent: pendingIntent
        ? {
            ...pendingIntent,
            missingFields: validation.missingFields,
          }
        : data.pendingIntent,
    });
  }

  const shouldExposeDraft =
    Boolean(validation.draftAction) &&
    (resolver.shouldCreateDraft ||
      resolver.classification === "ConfirmPendingAction" ||
      data.uiActions.some((action) => action.type === "create_draft") ||
      data.status === "draft_creation" ||
      data.status === "action_confirmation");

  if (!shouldExposeDraft || !validation.draftAction) {
    return chatDataSchema.parse({
      ...data,
      uiActions: data.uiActions.filter((action) => action.type !== "create_draft"),
      primaryCta: data.primaryCta?.type === "create_draft" ? null : data.primaryCta,
      secondaryCta: data.secondaryCta?.type === "create_draft" ? null : data.secondaryCta,
      needsReview: data.needsReview && data.uiActions.some((action) => action.type !== "create_draft"),
      pendingIntent,
    });
  }

  const canonical = draftActionSchema.parse(validation.draftAction);
  const action = createDraftUiAction(canonical);

  return chatDataSchema.parse({
    ...data,
    status: "draft_creation",
    responseMode: "propose_action",
    uiActions: [action],
    primaryCta: action,
    secondaryCta: data.secondaryCta?.type === "create_draft" ? null : data.secondaryCta,
    suggestedActions: [],
    needsReview: true,
    missingFields: [],
    pendingIntent: pendingIntent
      ? {
          intent: pendingIntent.intent,
          missingFields: [],
          draftCandidate: action.draftPayload,
        }
      : data.pendingIntent,
  });
}

export function buildCompletedResponse(completedAction?: Record<string, unknown>): ChatData {
  const type = asText(completedAction?.type) ?? "Action";
  const description =
    asText(completedAction?.description) ??
    asText(completedAction?.label) ??
    asText(completedAction?.category) ??
    "Finance item";
  const parsedAmount = asCents(completedAction?.amountCents);
  const detail = parsedAmount === null ? description : `${description}`;

  return chatDataSchema.parse({
    status: "completed",
    responseMode: "completed",
    confidence: 1,
    tone: "calm_premium",
    reply: `${description} has been added.`,
    insightLabel: "Update Complete",
    trajectoryLabel: null,
    headline: `${description} has been added.`,
    supportingBody: null,
    advisorNote: null,
    safeToSpendCents: null,
    projectedSurplusCents: null,
    nextBill: null,
    metricCards: [],
    merchantContext: null,
    coachPrompt: null,
    recommendationCard: null,
    primaryCta: null,
    secondaryCta: null,
    uiActions: [],
    suggestedActions: [],
    needsReview: false,
    missingFields: [],
    pendingIntent: null,
    assumptions: [],
    warnings: [],
    completionState: {
      kind: "success",
      label: `${type} added`,
      detail,
    },
  });
}

export function hasCreateDraftAction(data: ChatData): boolean {
  return data.uiActions.some((action) => action.type === "create_draft");
}

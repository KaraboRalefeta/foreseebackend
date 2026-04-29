import { z } from "zod";

export const INTENT_VALUES = [
  "Expense",
  "Income",
  "PlannedSpend",
  "UpcomingBill",
  "SplitExpense",
  "DebtRepayment",
  "Unknown",
] as const;

const LEGACY_CHAT_STATUS_VALUES = ["ready", "needs_input", "review_required"] as const;
const CHAT_STATUS_VALUES = [
  "briefing",
  "needs_detail",
  "warning",
  "action_confirmation",
  "draft_creation",
  "completed",
  "error",
] as const;
const CHAT_RESPONSE_MODE_VALUES = [
  "briefing",
  "clarify",
  "caution",
  "propose_action",
  "completed",
  "error",
] as const;
const METRIC_TONE_VALUES = ["positive", "neutral", "warning"] as const;
export const RESOLVER_CLASSIFICATION_VALUES = [
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
] as const;

export const financeEventTypeSchema = z.enum([
  "Spent",
  "Income",
  "Planned",
  "Bill",
  "Debt",
  "Expense",
  "expense",
  "income",
  "planned",
  "planned_spend",
  "PlannedSpend",
  "bill",
  "debt",
  "transfer",
]);

export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "monthKey must be YYYY-MM");

export const dateIsoSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "dateIso must be YYYY-MM-DD");

const currencySchema = z
  .string()
  .min(3)
  .max(8)
  .default("ZAR")
  .transform((v) => v.toUpperCase());

const localeSchema = z.string().min(2).max(16);
const timezoneSchema = z.string().min(2).max(80);
const amountCentsSchema = z.number().int().nonnegative();
const signedAmountCentsSchema = z.number().int();

const recentEventSchema = z
  .object({
    title: z.string().min(1).max(120),
    amountCents: amountCentsSchema,
    dateIso: dateIsoSchema,
    type: financeEventTypeSchema,
    category: z.string().min(1).max(80).optional(),
  })
  .strict();

const upcomingBillSchema = z
  .object({
    name: z.string().min(1).max(120),
    amountCents: amountCentsSchema,
    dueDateIso: dateIsoSchema,
    isPaid: z.boolean().optional(),
    category: z.string().min(1).max(80).optional(),
  })
  .strict();

const goalBalanceSchema = z
  .object({
    goalId: z.string().min(1).max(120),
    label: z.string().min(1).max(120),
    currentCents: amountCentsSchema,
    targetCents: amountCentsSchema,
    gapCents: amountCentsSchema.optional(),
  })
  .strict();

const categorySnapshotSchema = z
  .object({
    category: z.string().min(1).max(80),
    spentCents: amountCentsSchema,
    budgetCents: amountCentsSchema,
    paceVsLastMonthPct: z.number(),
  })
  .strict();

const conversationTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(2000),
    timestamp: z.number().int().nonnegative().optional(),
  })
  .strict();

export const pendingIntentSchema = z
  .object({
    intent: z.enum(INTENT_VALUES),
    missingFields: z.array(z.string().min(1).max(80)).max(20),
    draftCandidate: z.record(z.string(), z.unknown()),
  })
  .strict();

const chatContextSchema = z
  .object({
    monthKey: monthKeySchema.optional(),
    currency: currencySchema.optional(),
    locale: localeSchema.optional(),
    timezone: timezoneSchema.optional(),
    todayIso: dateIsoSchema.optional(),
    projectedEndCents: signedAmountCentsSchema.optional(),
    safeToSpendCents: signedAmountCentsSchema.optional(),
    availableCashCents: signedAmountCentsSchema.optional(),
    incomeExpectedCents: amountCentsSchema.optional(),
    incomeReceivedCents: amountCentsSchema.optional(),
    totalBudgetLimitCents: amountCentsSchema.optional(),
    budgetSafeRoomCents: signedAmountCentsSchema.optional(),
    upcomingBills: z.array(upcomingBillSchema).max(30).optional(),
    goalBalances: z.array(goalBalanceSchema).max(20).optional(),
    categorySnapshots: z.array(categorySnapshotSchema).max(24).optional(),
    recentEvents: z.array(recentEventSchema).max(40).optional(),
  })
  .strict();

const uiStateSchema = z
  .object({
    screen: z.string().min(1).max(80).optional(),
    selectedMonthKey: monthKeySchema.optional(),
    selectedDateIso: dateIsoSchema.nullable().optional(),
    draftOpen: z.boolean().optional(),
  })
  .passthrough();

const requestMetaSchema = z
  .object({
    source: z.string().min(1).max(80).optional(),
    clientVersion: z.string().min(1).max(40).optional(),
    requestTimeMs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const completedActionSchema = z
  .object({
    type: z.enum(INTENT_VALUES).exclude(["Unknown"]).optional(),
    amountCents: amountCentsSchema.optional(),
    description: z.string().min(1).max(200).optional(),
    category: z.string().min(1).max(80).optional(),
    label: z.string().min(1).max(120).optional(),
  })
  .passthrough();

export const chatRequestSchema = z
  .object({
    message: z.string().min(1),
    requestType: z.literal("chat").optional().default("chat"),
    sessionId: z.string().min(1).max(120).optional(),
    deviceId: z.string().min(1).max(120).optional(),
    monthKey: monthKeySchema.optional(),
    context: chatContextSchema.optional(),
    session: z
      .object({
        sessionId: z.string().min(1).max(120).optional(),
        deviceId: z.string().min(1).max(120).optional(),
        assistantPersona: z.string().min(1).max(80).optional(),
      })
      .strict()
      .optional(),
    conversation: z.array(conversationTurnSchema).max(12).optional(),
    pendingIntent: pendingIntentSchema.nullable().optional(),
    uiState: uiStateSchema.optional(),
    requestMeta: requestMetaSchema.optional(),
    appConfirmedAction: z.boolean().optional(),
    completedAction: completedActionSchema.optional(),
  })
  .strict();

export const parseRequestSchema = z
  .object({
    input: z.string().min(1),
    monthKey: monthKeySchema,
    defaultDateIso: dateIsoSchema.optional(),
    currency: currencySchema.optional(),
  })
  .strict();

const expenseDraftSchema = z
  .object({
    type: z.literal("Expense"),
    amountCents: amountCentsSchema,
    category: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
  })
  .strict();

const incomeDraftSchema = z
  .object({
    type: z.literal("Income"),
    amountCents: amountCentsSchema,
    source: z.string().min(1).max(80),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
  })
  .strict();

const plannedSpendDraftSchema = z
  .object({
    type: z.literal("PlannedSpend"),
    amountCents: amountCentsSchema,
    category: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
  })
  .strict();

const upcomingBillDraftSchema = z
  .object({
    type: z.literal("UpcomingBill"),
    amountCents: amountCentsSchema,
    category: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
    recurrence: z.enum(["None", "Weekly", "Monthly"]),
  })
  .strict();

const splitExpenseDraftSchema = z
  .object({
    type: z.literal("SplitExpense"),
    amountCents: amountCentsSchema,
    category: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
    personName: z.string().min(1).max(80),
    owedCents: amountCentsSchema,
  })
  .strict();

const debtRepaymentDraftSchema = z
  .object({
    type: z.literal("DebtRepayment"),
    amountCents: amountCentsSchema,
    personName: z.string().min(1).max(80),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
  })
  .strict();

export const draftActionSchema = z.discriminatedUnion("type", [
  expenseDraftSchema,
  incomeDraftSchema,
  plannedSpendDraftSchema,
  upcomingBillDraftSchema,
  splitExpenseDraftSchema,
  debtRepaymentDraftSchema,
]);

const draftTypeSchema = z.enum([
  "Expense",
  "Income",
  "PlannedSpend",
  "UpcomingBill",
  "SplitExpense",
  "DebtRepayment",
]);

const expensePayloadSchema = z
  .object({
    amountCents: amountCentsSchema,
    category: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
  })
  .strict();

const incomePayloadSchema = z
  .object({
    amountCents: amountCentsSchema,
    source: z.string().min(1).max(80),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
  })
  .strict();

const plannedSpendPayloadSchema = z
  .object({
    amountCents: amountCentsSchema,
    category: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
  })
  .strict();

const upcomingBillPayloadSchema = z
  .object({
    amountCents: amountCentsSchema,
    category: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
    recurrence: z.enum(["None", "Weekly", "Monthly"]),
  })
  .strict();

const splitExpensePayloadSchema = z
  .object({
    amountCents: amountCentsSchema,
    category: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
    personName: z.string().min(1).max(80),
    owedCents: amountCentsSchema,
  })
  .strict();

const debtRepaymentPayloadSchema = z
  .object({
    amountCents: amountCentsSchema,
    personName: z.string().min(1).max(80),
    dateIso: dateIsoSchema,
    monthKey: monthKeySchema,
  })
  .strict();

const actionIntentSchema = z.string().min(1).max(80);

const createDraftUiActionSchema = z.discriminatedUnion("draftType", [
  z
    .object({
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(60),
      type: z.literal("create_draft"),
      target: z.string().min(1).max(120),
      intent: actionIntentSchema.optional(),
      draftType: z.literal("Expense"),
      draftPayload: expensePayloadSchema,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(60),
      type: z.literal("create_draft"),
      target: z.string().min(1).max(120),
      intent: actionIntentSchema.optional(),
      draftType: z.literal("Income"),
      draftPayload: incomePayloadSchema,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(60),
      type: z.literal("create_draft"),
      target: z.string().min(1).max(120),
      intent: actionIntentSchema.optional(),
      draftType: z.literal("PlannedSpend"),
      draftPayload: plannedSpendPayloadSchema,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(60),
      type: z.literal("create_draft"),
      target: z.string().min(1).max(120),
      intent: actionIntentSchema.optional(),
      draftType: z.literal("UpcomingBill"),
      draftPayload: upcomingBillPayloadSchema,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(60),
      type: z.literal("create_draft"),
      target: z.string().min(1).max(120),
      intent: actionIntentSchema.optional(),
      draftType: z.literal("SplitExpense"),
      draftPayload: splitExpensePayloadSchema,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(60),
      type: z.literal("create_draft"),
      target: z.string().min(1).max(120),
      intent: actionIntentSchema.optional(),
      draftType: z.literal("DebtRepayment"),
      draftPayload: debtRepaymentPayloadSchema,
    })
    .strict(),
]);

const openInputUiActionSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(60),
    type: z.literal("open_input"),
    target: z.string().min(1).max(120),
    intent: actionIntentSchema.optional(),
  })
  .strict();

const uiActionSchema = z.union([createDraftUiActionSchema, openInputUiActionSchema]);

const ctaActionSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(60),
    type: z.string().min(1).max(80),
    target: z.string().min(1).max(120).optional(),
    intent: actionIntentSchema.optional(),
    draftType: draftTypeSchema.optional(),
    draftPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const modelUiActionSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(60),
    type: z.enum(["create_draft", "open_input"]),
    target: z.string().min(1).max(120).optional(),
    intent: actionIntentSchema.optional(),
    draftType: draftTypeSchema.optional(),
    draftPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const metricCardSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
    valueText: z.string().min(1).max(60),
    valueCents: signedAmountCentsSchema.nullable().optional(),
    tone: z.enum(METRIC_TONE_VALUES),
  })
  .strict();

const recommendationCardSchema = z
  .object({
    eyebrow: z.string().min(1).max(60).nullable().optional(),
    title: z.string().min(1).max(180),
    body: z.string().min(1).max(260),
    emphasisAmountText: z.string().min(1).max(40).nullable().optional(),
  })
  .strict();

const merchantContextSchema = z
  .object({
    kind: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
    valueText: z.string().min(1).max(60),
    explanation: z.string().min(1).max(180),
  })
  .strict();

const completionStateSchema = z
  .object({
    kind: z.string().min(1).max(40),
    label: z.string().min(1).max(80),
    detail: z.string().min(1).max(120).nullable().optional(),
  })
  .strict();

const responseBillSchema = z
  .object({
    name: z.string().min(1).max(120),
    amountCents: amountCentsSchema,
    dueDateIso: dateIsoSchema,
    isPaid: z.boolean().optional(),
    category: z.string().min(1).max(80).optional(),
    amountText: z.string().min(1).max(60).optional(),
  })
  .strict();

export const parseDataSchema = z
  .object({
    draftAction: draftActionSchema.nullable(),
    intent: z.enum(INTENT_VALUES),
    needsReview: z.boolean(),
    confidence: z.number().min(0).max(1),
    summary: z.string().min(1).max(280),
    warnings: z.array(z.string().min(1).max(180)).max(8),
  })
  .strict();

export const chatDataSchema = z
  .object({
    status: z.enum(CHAT_STATUS_VALUES),
    responseMode: z.enum(CHAT_RESPONSE_MODE_VALUES),
    confidence: z.number().min(0).max(1),
    tone: z.string().min(1).max(40).nullable().optional(),
    reply: z.string().min(1).max(3000),
    insightLabel: z.string().min(1).max(80).nullable().optional(),
    trajectoryLabel: z.string().min(1).max(80).nullable().optional(),
    headline: z.string().min(1).max(220).nullable().optional(),
    supportingBody: z.string().min(1).max(600).nullable().optional(),
    advisorNote: z.string().min(1).max(320).nullable().optional(),
    safeToSpendCents: signedAmountCentsSchema.nullable().optional(),
    projectedSurplusCents: signedAmountCentsSchema.nullable().optional(),
    nextBill: responseBillSchema.nullable().optional(),
    metricCards: z.array(metricCardSchema).max(4),
    merchantContext: merchantContextSchema.nullable().optional(),
    coachPrompt: z.string().min(1).max(220).nullable().optional(),
    recommendationCard: recommendationCardSchema.nullable().optional(),
    primaryCta: ctaActionSchema.nullable().optional(),
    secondaryCta: ctaActionSchema.nullable().optional(),
    uiActions: z.array(uiActionSchema).max(8),
    suggestedActions: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            reason: z.string().min(1).max(300),
            draftAction: draftActionSchema,
          })
          .strict(),
      )
      .max(5),
    needsReview: z.boolean(),
    missingFields: z.array(z.string().min(1).max(80)).max(12),
    pendingIntent: pendingIntentSchema.nullable(),
    assumptions: z.array(z.string().min(1).max(180)).max(12),
    warnings: z.array(z.string().min(1).max(180)).max(8),
    completionState: completionStateSchema.nullable().optional(),
  })
  .strict();

export const parseModelOutputSchema = z
  .object({
    intent: z.enum(INTENT_VALUES),
    confidence: z.number().min(0).max(1).optional(),
    summary: z.string().min(1).max(280).optional(),
    needsReview: z.boolean().optional(),
    warnings: z.array(z.string().min(1).max(180)).max(8).optional(),
    draftAction: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const chatModelOutputSchema = z
  .object({
    status: z.enum([...LEGACY_CHAT_STATUS_VALUES, ...CHAT_STATUS_VALUES]).optional(),
    responseMode: z.enum(CHAT_RESPONSE_MODE_VALUES).optional(),
    confidence: z.number().min(0).max(1).optional(),
    tone: z.string().min(1).max(40).optional(),
    reply: z.string().min(1).max(3000),
    insightLabel: z.string().min(1).max(80).optional(),
    trajectoryLabel: z.string().min(1).max(80).optional(),
    headline: z.string().min(1).max(220).optional(),
    supportingBody: z.string().min(1).max(600).optional(),
    advisorNote: z.string().min(1).max(320).optional(),
    safeToSpendCents: signedAmountCentsSchema.optional(),
    projectedSurplusCents: signedAmountCentsSchema.optional(),
    nextBill: responseBillSchema.nullable().optional(),
    metricCards: z.array(metricCardSchema).max(4).optional(),
    merchantContext: merchantContextSchema.nullable().optional(),
    coachPrompt: z.string().min(1).max(220).optional(),
    recommendationCard: recommendationCardSchema.nullable().optional(),
    primaryCta: ctaActionSchema.nullable().optional(),
    secondaryCta: ctaActionSchema.nullable().optional(),
    uiActions: z.array(modelUiActionSchema).max(8).optional(),
    suggestedActions: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            reason: z.string().min(1).max(300),
            draftAction: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(5)
      .optional(),
    needsReview: z.boolean().optional(),
    missingFields: z.array(z.string().min(1).max(80)).max(12).optional(),
    pendingIntent: pendingIntentSchema.nullable().optional(),
    assumptions: z.array(z.string().min(1).max(180)).max(12).optional(),
    warnings: z.array(z.string().min(1).max(180)).max(8).optional(),
    completionState: completionStateSchema.nullable().optional(),
  })
  .strict();

export const contextResolverOutputSchema = z
  .object({
    classification: z.enum(RESOLVER_CLASSIFICATION_VALUES),
    refersToPendingIntent: z.boolean().optional(),
    resolvedIntent: z.enum(INTENT_VALUES).nullable().optional(),
    shouldCreateDraft: z.boolean().optional(),
    shouldAskForDetail: z.boolean().optional(),
    shouldAnswerQuestion: z.boolean().optional(),
    shouldRunAffordabilityCheck: z.boolean().optional(),
    missingFields: z.array(z.string().min(1).max(80)).max(12).optional(),
    fieldUpdates: z.record(z.string(), z.unknown()).optional(),
    resolvedDraftCandidate: z.record(z.string(), z.unknown()).nullable().optional(),
    requestedAmountCents: amountCentsSchema.nullable().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ParseRequest = z.infer<typeof parseRequestSchema>;
export type DraftAction = z.infer<typeof draftActionSchema>;
export type ParseData = z.infer<typeof parseDataSchema>;
export type ChatData = z.infer<typeof chatDataSchema>;
export type ParseModelOutput = z.infer<typeof parseModelOutputSchema>;
export type ChatModelOutput = z.infer<typeof chatModelOutputSchema>;
export type ContextResolverOutput = z.infer<typeof contextResolverOutputSchema>;
export type Intent = (typeof INTENT_VALUES)[number];

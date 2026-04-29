import { extractRequestedAmountCents } from "@/lib/ai/affordability";
import {
  contextResolverOutputSchema,
  type ChatRequest,
  type ContextResolverOutput,
  type Intent,
} from "@/lib/ai/schemas";
import type { PendingIntent } from "@/lib/ai/draft-safety";

type ResolverInput = {
  message: string;
  conversation: ChatRequest["conversation"];
  pendingIntent: PendingIntent | null;
  context: ChatRequest["context"];
  uiState: ChatRequest["uiState"];
};

function isConfirmation(message: string): boolean {
  return /^(yes|yep|yeah|ok|okay|sure|confirm|please do|do it|go ahead|save it|add it|set it|sounds good|let's do that|lets do that)\b/i.test(
    message.trim(),
  );
}

function isRejection(message: string): boolean {
  return /^(no|nope|cancel|never mind|nevermind|leave it|stop|discard)\b/i.test(message.trim());
}

function isHesitation(message: string): boolean {
  return /^(maybe|not sure|i'?ll think|later|hold on|pause)\b/i.test(message.trim());
}

function inferIntentFromMessage(message: string): Intent {
  const lowered = message.toLowerCase();
  if (/\b(income|salary|paid me|received|earned)\b/.test(lowered)) {
    return "Income";
  }
  if (/\b(plan|set aside|reserve|budget)\b/.test(lowered)) {
    return "PlannedSpend";
  }
  if (/\b(bill|upcoming|due|subscription|debit order)\b/.test(lowered)) {
    return "UpcomingBill";
  }
  if (/\b(split|owed|owe me|with \w+)\b/.test(lowered)) {
    return "SplitExpense";
  }
  if (/\b(repay|repayment|paid back|debt)\b/.test(lowered)) {
    return "DebtRepayment";
  }
  if (/\b(spent|paid|bought|add|track)\b/.test(lowered) || extractRequestedAmountCents(message) !== null) {
    return "Expense";
  }
  return "Unknown";
}

function classificationForIntent(intent: Intent): ContextResolverOutput["classification"] {
  switch (intent) {
    case "Expense":
      return "CreateExpense";
    case "Income":
      return "CreateIncome";
    case "PlannedSpend":
      return "CreatePlannedSpend";
    case "UpcomingBill":
      return "CreateUpcomingBill";
    case "SplitExpense":
      return "CreateSplitExpense";
    case "DebtRepayment":
      return "CreateDebtRepayment";
    case "Unknown":
      return "Unknown";
  }
}

function inferCategory(message: string): string | undefined {
  const lowered = message.toLowerCase();
  if (/\b(grocery|groceries)\b/.test(lowered)) return "Groceries";
  if (/\b(lunch|dinner|food|restaurant|takeaway)\b/.test(lowered)) return "Food";
  if (/\b(transport|taxi|uber|bus|train|fuel|petrol)\b/.test(lowered)) return "Transportation";
  if (/\b(rent|housing)\b/.test(lowered)) return "Housing";
  if (/\b(subscription|netflix|spotify)\b/.test(lowered)) return "Subscriptions";
  return undefined;
}

function inferDescription(message: string): string | undefined {
  const cleaned = message
    .replace(/\b(spent|paid|plan|set aside|reserve|add|track|for|on)\b/gi, " ")
    .replace(/(?:r|zar)\s*[\d][\d\s,]*(?:\.\d{1,2})?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return undefined;
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function standaloneAmountAnswer(message: string): boolean {
  return /^\s*(?:r|zar)?\s*\d[\d\s,]*(?:\.\d{1,2})?\s*$/i.test(message);
}

export function deterministicResolve(input: ResolverInput): ContextResolverOutput {
  const { message, pendingIntent, context } = input;
  const requestedAmountCents = extractRequestedAmountCents(message);
  const hasPending = Boolean(pendingIntent && pendingIntent.intent !== "Unknown");

  if (hasPending && isConfirmation(message)) {
    return contextResolverOutputSchema.parse({
      classification: "ConfirmPendingAction",
      refersToPendingIntent: true,
      resolvedIntent: pendingIntent?.intent,
      shouldCreateDraft: true,
      shouldAskForDetail: false,
      shouldAnswerQuestion: false,
      shouldRunAffordabilityCheck: false,
      missingFields: pendingIntent?.missingFields ?? [],
      fieldUpdates: {},
      resolvedDraftCandidate: pendingIntent?.draftCandidate ?? {},
      confidence: 0.96,
    });
  }

  if (hasPending && isRejection(message)) {
    return contextResolverOutputSchema.parse({
      classification: "RejectPendingAction",
      refersToPendingIntent: true,
      resolvedIntent: pendingIntent?.intent,
      shouldCreateDraft: false,
      shouldAskForDetail: false,
      shouldAnswerQuestion: false,
      shouldRunAffordabilityCheck: false,
      missingFields: [],
      fieldUpdates: {},
      resolvedDraftCandidate: pendingIntent?.draftCandidate ?? {},
      confidence: 0.95,
    });
  }

  if (hasPending && isHesitation(message)) {
    return contextResolverOutputSchema.parse({
      classification: "HesitateOnPendingAction",
      refersToPendingIntent: true,
      resolvedIntent: pendingIntent?.intent,
      shouldCreateDraft: false,
      shouldAskForDetail: false,
      shouldAnswerQuestion: false,
      shouldRunAffordabilityCheck: false,
      missingFields: [],
      fieldUpdates: {},
      resolvedDraftCandidate: pendingIntent?.draftCandidate ?? {},
      confidence: 0.93,
    });
  }

  if (hasPending && requestedAmountCents !== null) {
    const classification = standaloneAmountAnswer(message)
      ? "MissingDetailAnswer"
      : "ModifyPendingAction";
    return contextResolverOutputSchema.parse({
      classification,
      refersToPendingIntent: true,
      resolvedIntent: pendingIntent?.intent,
      shouldCreateDraft: classification === "MissingDetailAnswer",
      shouldAskForDetail: false,
      shouldAnswerQuestion: false,
      shouldRunAffordabilityCheck: true,
      requestedAmountCents,
      missingFields: [],
      fieldUpdates: { amountCents: requestedAmountCents },
      resolvedDraftCandidate: {
        ...(pendingIntent?.draftCandidate ?? {}),
        amountCents: requestedAmountCents,
      },
      confidence: 0.94,
    });
  }

  if (hasPending && /\bafford\b|\bcan i\b.*\bit\b/i.test(message)) {
    const pendingAmount = pendingIntent?.draftCandidate.amountCents;
    return contextResolverOutputSchema.parse({
      classification: "AffordabilityCheck",
      refersToPendingIntent: true,
      resolvedIntent: pendingIntent?.intent,
      shouldCreateDraft: false,
      shouldAskForDetail: false,
      shouldAnswerQuestion: true,
      shouldRunAffordabilityCheck: true,
      requestedAmountCents:
        typeof pendingAmount === "number" ? pendingAmount : requestedAmountCents,
      missingFields: [],
      fieldUpdates: {},
      resolvedDraftCandidate: pendingIntent?.draftCandidate ?? {},
      confidence: 0.9,
    });
  }

  const intent = inferIntentFromMessage(message);
  const category = inferCategory(message);
  const description = inferDescription(message) ?? category;
  const monthKey = context?.monthKey;
  const todayIso = context?.todayIso;
  const draftCandidate: Record<string, unknown> = {};
  if (requestedAmountCents !== null) draftCandidate.amountCents = requestedAmountCents;
  if (category) draftCandidate.category = category;
  if (description) draftCandidate.description = description;
  if (monthKey) draftCandidate.monthKey = monthKey;
  if (todayIso) draftCandidate.dateIso = todayIso;

  if (intent !== "Unknown") {
    const missingFields = requestedAmountCents === null ? ["amountCents"] : [];
    return contextResolverOutputSchema.parse({
      classification: classificationForIntent(intent),
      refersToPendingIntent: false,
      resolvedIntent: intent,
      shouldCreateDraft: missingFields.length === 0,
      shouldAskForDetail: missingFields.length > 0,
      shouldAnswerQuestion: false,
      shouldRunAffordabilityCheck: requestedAmountCents !== null,
      requestedAmountCents,
      missingFields,
      fieldUpdates: draftCandidate,
      resolvedDraftCandidate: draftCandidate,
      confidence: requestedAmountCents === null ? 0.82 : 0.9,
    });
  }

  if (/\?|\bhow\b|\bwhat\b|\bcan i\b|\bshould i\b|\bafford\b/i.test(message)) {
    return contextResolverOutputSchema.parse({
      classification: /\bafford\b/i.test(message) ? "AffordabilityCheck" : "AskQuestion",
      refersToPendingIntent: false,
      resolvedIntent: "Unknown",
      shouldCreateDraft: false,
      shouldAskForDetail: false,
      shouldAnswerQuestion: true,
      shouldRunAffordabilityCheck: /\bafford\b/i.test(message),
      requestedAmountCents,
      missingFields: [],
      fieldUpdates: {},
      resolvedDraftCandidate: null,
      confidence: 0.82,
    });
  }

  return contextResolverOutputSchema.parse({
    classification: "GeneralFinanceAdvice",
    refersToPendingIntent: false,
    resolvedIntent: "Unknown",
    shouldCreateDraft: false,
    shouldAskForDetail: false,
    shouldAnswerQuestion: true,
    shouldRunAffordabilityCheck: false,
    missingFields: [],
    fieldUpdates: {},
    resolvedDraftCandidate: null,
    confidence: 0.7,
  });
}

export function reconcileResolverOutput(
  modelOutput: unknown,
  deterministic: ContextResolverOutput,
): ContextResolverOutput {
  const parsed = contextResolverOutputSchema.safeParse(modelOutput);
  if (!parsed.success) {
    return deterministic;
  }

  const highValueClasses = new Set<ContextResolverOutput["classification"]>([
    "ConfirmPendingAction",
    "RejectPendingAction",
    "HesitateOnPendingAction",
    "ModifyPendingAction",
    "MissingDetailAnswer",
    "AffordabilityCheck",
  ]);

  if (
    highValueClasses.has(deterministic.classification) &&
    (deterministic.confidence ?? 0) >= 0.9
  ) {
    return deterministic;
  }

  return contextResolverOutputSchema.parse({
    ...parsed.data,
    fieldUpdates: {
      ...(parsed.data.fieldUpdates ?? {}),
      ...(deterministic.fieldUpdates ?? {}),
    },
    resolvedDraftCandidate:
      parsed.data.resolvedDraftCandidate ?? deterministic.resolvedDraftCandidate,
    requestedAmountCents:
      parsed.data.requestedAmountCents ?? deterministic.requestedAmountCents,
  });
}

export function buildResolverPromptInput(input: ResolverInput): string {
  return JSON.stringify(
    {
      message: input.message,
      conversation: input.conversation ?? [],
      pendingIntent: input.pendingIntent,
      uiState: input.uiState ?? null,
      context: input.context ?? {},
    },
    null,
    2,
  );
}

import { computeAffordability } from "@/lib/ai/affordability";
import type {
  ChatModelOutput,
  ChatRequest,
  DraftAction,
  ParseModelOutput,
  ParseRequest,
} from "@/lib/ai/schemas";
import {
  chatDataSchema,
  draftActionSchema,
  monthKeySchema,
  parseDataSchema,
  parseModelOutputSchema,
} from "@/lib/ai/schemas";

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  if (!Number.isInteger(rounded) || rounded < 0) {
    return null;
  }

  return rounded;
}

function toSignedCents(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function canonicalWarning(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("day-only") || (lower.includes("interpreted") && lower.includes("date"))) {
    return "Date was interpreted from day-only input and should be reviewed.";
  }

  if (lower.includes("defaultdateiso") || lower.includes("default date")) {
    return "Used defaultDateIso because no exact date was confidently parsed.";
  }

  if (lower.includes("first day of month") || lower.includes("date was ambiguous")) {
    return "Used first day of month because the date was ambiguous.";
  }

  return message.trim();
}

function dedupeWarnings(warnings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const warning of warnings) {
    const canonical = canonicalWarning(warning);
    if (!canonical) {
      continue;
    }

    const key = canonical.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(canonical);
  }

  return out.slice(0, 8);
}

function dedupeStrings(values: string[], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }

  return out.slice(0, max);
}

function normalizeCategory(rawCategory: unknown, inputText: string): string {
  const source = `${asText(rawCategory) ?? ""} ${inputText}`.toLowerCase();

  if (/grocer|food|lunch|dinner|restaurant|cafe|takeaway|meal/.test(source)) {
    return "Food & Dining";
  }

  if (/rent|mortgage|housing|electric|water|utility|internet|wifi/.test(source)) {
    return "Housing";
  }

  if (/transport|uber|taxi|fuel|petrol|gas|bus|train/.test(source)) {
    return "Transport";
  }

  if (/health|medical|doctor|pharmacy/.test(source)) {
    return "Health";
  }

  if (/debt|loan|repay/.test(source)) {
    return "Debt";
  }

  if (/entertain|movie|netflix|spotify|game/.test(source)) {
    return "Entertainment";
  }

  const existing = asText(rawCategory);
  return existing ? toTitleCase(existing) : "Uncategorized";
}

function extractDescriptionFromInput(inputText: string): string | undefined {
  const compact = inputText.trim().replace(/\s+/g, " ");

  const matchFor = compact.match(/\b(?:for|on)\s+(.+)/i);
  if (matchFor?.[1]) {
    return toTitleCase(
      matchFor[1]
        .replace(/\bwith\s+[A-Za-z][A-Za-z'\-\s]*$/i, "")
        .replace(/\b(on|at)\s+\d{1,2}(?:st|nd|rd|th)?\b.*/i, "")
        .trim(),
    );
  }

  return undefined;
}

function inferDescription(rawDescription: unknown, inputText: string, fallback: string): string {
  const fromRaw = asText(rawDescription);
  if (fromRaw) {
    return toTitleCase(fromRaw);
  }

  const fromInput = extractDescriptionFromInput(inputText);
  if (fromInput) {
    return fromInput;
  }

  return fallback;
}

function resolveDate(
  rawDate: unknown,
  monthKey: string,
  defaultDateIso?: string,
): { dateIso: string; warning?: string } {
  const dateValue = asText(rawDate);

  if (dateValue && isIsoDate(dateValue)) {
    return { dateIso: dateValue };
  }

  if (dateValue && /^\d{1,2}$/.test(dateValue)) {
    const day = dateValue.padStart(2, "0");
    const resolved = `${monthKey}-${day}`;

    if (isIsoDate(resolved)) {
      return {
        dateIso: resolved,
        warning: "Date was interpreted from day-only input and should be reviewed.",
      };
    }
  }

  if (defaultDateIso && isIsoDate(defaultDateIso)) {
    return {
      dateIso: defaultDateIso,
      warning: "Used defaultDateIso because no exact date was confidently parsed.",
    };
  }

  return {
    dateIso: `${monthKey}-01`,
    warning: "Used first day of month because the date was ambiguous.",
  };
}

function extractAmountCentsFromText(inputText: string): number | null {
  const shortK = inputText.match(/(?:r|zar)?\s*(\d+(?:\.\d+)?)\s*k\b/i);
  if (shortK?.[1]) {
    const value = Number(shortK[1]);
    if (Number.isFinite(value)) {
      return Math.round(value * 1000 * 100);
    }
  }

  const match = inputText.match(/(?:r|zar|R)\s*(\d+(?:[.,]\d{1,2})?)/i);

  if (!match?.[1]) {
    return null;
  }

  const raw = match[1].replace(/,/g, "");
  const [whole, fractional = ""] = raw.split(".");
  const wholeNumber = Number(whole);

  if (!Number.isFinite(wholeNumber)) {
    return null;
  }

  const cents = Number((fractional + "00").slice(0, 2));
  return wholeNumber * 100 + cents;
}

function inferIntentFromText(inputText: string): ParseModelOutput["intent"] {
  const text = inputText.toLowerCase();

  if (/\bwith\s+[a-z][a-z'\-]+\b/.test(text) && /\b(paid|spent|covered|bought)\b/.test(text)) {
    return "SplitExpense";
  }

  if (/\b(paid me back|payback|repaid)\b/.test(text)) {
    return "DebtRepayment";
  }

  if (/\b(got paid|salary|income|received)\b/.test(text)) {
    return "Income";
  }

  if (/\b(plan|planned|budget|set aside)\b/.test(text)) {
    return "PlannedSpend";
  }

  if (/\b(trip|travel|vacation|holiday)\b/.test(text)) {
    return "PlannedSpend";
  }

  if (/\b(bill|rent|due|upcoming)\b/.test(text)) {
    return "UpcomingBill";
  }

  if (/\b(spent|paid|bought|purchase)\b/.test(text)) {
    return "Expense";
  }

  return "Unknown";
}

export function coerceParseModelOutput(raw: unknown, request: ParseRequest): ParseModelOutput {
  const strict = parseModelOutputSchema.safeParse(raw);
  if (strict.success) {
    return strict.data;
  }

  const candidate = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawIntent = asText(candidate.intent);
  const inferredIntent = inferIntentFromText(request.input);

  const intent: ParseModelOutput["intent"] =
    rawIntent === "Expense" ||
    rawIntent === "Income" ||
    rawIntent === "PlannedSpend" ||
    rawIntent === "UpcomingBill" ||
    rawIntent === "SplitExpense" ||
    rawIntent === "DebtRepayment" ||
    rawIntent === "Unknown"
      ? rawIntent
      : inferredIntent;

  const warnings = Array.isArray(candidate.warnings)
    ? candidate.warnings.map((w) => asText(w)).filter((w): w is string => Boolean(w))
    : [];

  warnings.push("Model output format drifted; soft-parse fallback applied.");

  return {
    intent,
    confidence: Math.min(Math.max(toNumber(candidate.confidence) ?? 0.58, 0), 1),
    summary:
      asText(candidate.summary) ??
      "I could not fully parse this yet. Please confirm amount, date, and category before saving.",
    needsReview: true,
    warnings: warnings.slice(0, 8),
    draftAction:
      candidate.draftAction && typeof candidate.draftAction === "object"
        ? (candidate.draftAction as Record<string, unknown>)
        : null,
  };
}

function maybeInferSplitExpense(
  inputText: string,
  monthKey: string,
  defaultDateIso?: string,
): { draftAction: DraftAction; warnings: string[] } | null {
  const withPerson = inputText.match(/\bwith\s+([A-Za-z][A-Za-z'\-]{1,40})\b/i);
  const paidVerb = /\b(i\s+)?(paid|spent|covered|bought)\b/i.test(inputText);
  const amountCents = extractAmountCentsFromText(inputText);

  if (!withPerson || !paidVerb || amountCents === null) {
    return null;
  }

  const personName = toTitleCase(withPerson[1]);
  const { dateIso, warning } = resolveDate(undefined, monthKey, defaultDateIso);

  const warnings = [
    "Detected shared expense from phrasing and converted to SplitExpense.",
    "owedCents was inferred as half the total and should be reviewed.",
  ];

  if (warning) {
    warnings.push(warning);
  }

  return {
    draftAction: {
      type: "SplitExpense",
      amountCents,
      category: normalizeCategory("", inputText),
      description: inferDescription(undefined, inputText, "Lunch with Friend"),
      dateIso,
      monthKey,
      personName,
      owedCents: Math.round(amountCents / 2),
    },
    warnings,
  };
}

function normalizeDraftAction(
  rawDraftAction: unknown,
  monthKey: string,
  inputText: string,
  defaultDateIso?: string,
): { draftAction: DraftAction | null; warnings: string[]; explicitFields: boolean } {
  if (!rawDraftAction || typeof rawDraftAction !== "object") {
    return {
      draftAction: null,
      warnings: ["No draft action was produced by the model."],
      explicitFields: false,
    };
  }

  const candidate = rawDraftAction as Record<string, unknown>;
  const rawType = asText(candidate.type);

  if (!rawType) {
    return {
      draftAction: null,
      warnings: ["Draft action type is missing."],
      explicitFields: false,
    };
  }

  const warnings: string[] = [];
  const { dateIso, warning } = resolveDate(candidate.dateIso, monthKey, defaultDateIso);

  if (warning) {
    warnings.push(warning);
  }

  const amountCents = toCents(candidate.amountCents);
  if (amountCents === null) {
    return {
      draftAction: null,
      warnings: ["Amount must be an integer value in cents."],
      explicitFields: false,
    };
  }

  let normalized: DraftAction | null = null;
  let explicitFields = Boolean(asText(candidate.dateIso) && asText(candidate.type));

  switch (rawType) {
    case "Expense": {
      normalized = {
        type: "Expense",
        amountCents,
        category: normalizeCategory(candidate.category, inputText),
        description: inferDescription(candidate.description, inputText, "Manual Expense"),
        dateIso,
        monthKey,
      };
      explicitFields = explicitFields && Boolean(asText(candidate.category));
      break;
    }
    case "Income": {
      normalized = {
        type: "Income",
        amountCents,
        source: asText(candidate.source) ? toTitleCase(candidate.source as string) : "Other",
        dateIso,
        monthKey,
      };
      explicitFields = explicitFields && Boolean(asText(candidate.source));
      break;
    }
    case "PlannedSpend": {
      normalized = {
        type: "PlannedSpend",
        amountCents,
        category: normalizeCategory(candidate.category, inputText),
        description: inferDescription(candidate.description, inputText, "Planned Expense"),
        dateIso,
        monthKey,
      };
      explicitFields = explicitFields && Boolean(asText(candidate.category));
      break;
    }
    case "UpcomingBill": {
      const recurrence = asText(candidate.recurrence);
      normalized = {
        type: "UpcomingBill",
        amountCents,
        category: normalizeCategory(candidate.category, inputText),
        description: inferDescription(candidate.description, inputText, "Upcoming Bill"),
        dateIso,
        monthKey,
        recurrence:
          recurrence === "Weekly" || recurrence === "Monthly" || recurrence === "None"
            ? recurrence
            : "None",
      };
      explicitFields = explicitFields && Boolean(asText(candidate.recurrence));
      break;
    }
    case "SplitExpense": {
      const owedCents = toCents(candidate.owedCents);
      if (owedCents === null) {
        return {
          draftAction: null,
          warnings: ["SplitExpense owedCents must be an integer in cents."],
          explicitFields: false,
        };
      }
      if (owedCents > amountCents) {
        warnings.push("owedCents is greater than amountCents and should be reviewed.");
      }
      normalized = {
        type: "SplitExpense",
        amountCents,
        category: normalizeCategory(candidate.category, inputText),
        description: inferDescription(candidate.description, inputText, "Shared Expense"),
        dateIso,
        monthKey,
        personName: asText(candidate.personName)
          ? toTitleCase(candidate.personName as string)
          : "Unknown",
        owedCents,
      };
      explicitFields =
        explicitFields && Boolean(asText(candidate.personName)) && Boolean(candidate.owedCents);
      break;
    }
    case "DebtRepayment": {
      normalized = {
        type: "DebtRepayment",
        amountCents,
        personName: asText(candidate.personName)
          ? toTitleCase(candidate.personName as string)
          : "Unknown",
        dateIso,
        monthKey,
      };
      explicitFields = explicitFields && Boolean(asText(candidate.personName));
      break;
    }
    default:
      return {
        draftAction: null,
        warnings: ["Intent could not be mapped to a supported draft action."],
        explicitFields: false,
      };
  }

  const strictDraft = draftActionSchema.safeParse(normalized);

  if (!strictDraft.success) {
    return {
      draftAction: null,
      warnings: [
        "Draft action failed strict schema validation.",
        ...strictDraft.error.issues.map((issue) => issue.message),
      ].slice(0, 6),
      explicitFields: false,
    };
  }

  return {
    draftAction: strictDraft.data,
    warnings,
    explicitFields,
  };
}

export function normalizeParseOutput(
  modelOutput: ParseModelOutput,
  request: ParseRequest,
): ReturnType<typeof parseDataSchema.parse> {
  const warnings = [...(modelOutput.warnings ?? [])];
  const summary =
    asText(modelOutput.summary) ?? "Please review this draft action before confirming in the app.";

  let normalizedDraft = normalizeDraftAction(
    modelOutput.draftAction,
    request.monthKey,
    request.input,
    request.defaultDateIso,
  );

  if (
    !normalizedDraft.draftAction &&
    (modelOutput.intent === "Expense" || modelOutput.intent === "Unknown")
  ) {
    const inferredSplit = maybeInferSplitExpense(
      request.input,
      request.monthKey,
      request.defaultDateIso,
    );

    if (inferredSplit) {
      normalizedDraft = {
        draftAction: inferredSplit.draftAction,
        warnings: inferredSplit.warnings,
        explicitFields: false,
      };
    }
  }

  warnings.push(...normalizedDraft.warnings);

  if (modelOutput.intent === "Unknown" && !normalizedDraft.draftAction) {
    const unknownResult = {
      draftAction: null,
      intent: "Unknown" as const,
      needsReview: true,
      confidence: Math.min(modelOutput.confidence ?? 0.2, 0.79),
      summary,
      warnings:
        warnings.length > 0
          ? dedupeWarnings(warnings)
          : ["Could not confidently parse this command into a finance action."],
    };

    return parseDataSchema.parse(unknownResult);
  }

  if (!normalizedDraft.draftAction) {
    return parseDataSchema.parse({
      draftAction: null,
      intent: "Unknown",
      needsReview: true,
      confidence: 0.2,
      summary,
      warnings: dedupeWarnings(warnings),
    });
  }

  const draftIntent = normalizedDraft.draftAction.type;
  const dedupedWarnings = dedupeWarnings(warnings);
  const needsReview = (modelOutput.needsReview ?? false) || dedupedWarnings.length > 0;

  let confidence = Math.max(0, Math.min(1, modelOutput.confidence ?? 0.8));

  if (needsReview) {
    confidence = Math.min(confidence, 0.79);
  }

  if (confidence >= 0.9 && (needsReview || dedupedWarnings.length > 0 || !normalizedDraft.explicitFields)) {
    confidence = 0.89;
  }

  const result = {
    draftAction: normalizedDraft.draftAction,
    intent: draftIntent,
    needsReview,
    confidence,
    summary,
    warnings: dedupedWarnings,
  };

  return parseDataSchema.parse(result);
}

export function normalizeChatOutput(
  rawOutput: ChatModelOutput,
  request?: ChatRequest,
): ReturnType<typeof chatDataSchema.parse> {
  const warnings = [...(rawOutput.warnings ?? [])];
  const assumptions = [...(rawOutput.assumptions ?? [])];
  const currency = request?.context?.currency ?? "ZAR";
  const locale = request?.context?.locale ?? "en-ZA";

  const formatCurrencyCents = (valueCents: number) => {
    try {
      const minimumFractionDigits = valueCents % 100 === 0 ? 0 : 2;
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits,
        maximumFractionDigits: 2,
      }).format(valueCents / 100);
    } catch {
      return `${currency} ${(valueCents / 100).toFixed(2)}`;
    }
  };

  const slugify = (value: string, fallback: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || fallback;

  const looksLikeConfirmation = (message: string) =>
    /^(yes|yep|yeah|ok|okay|sure|confirm|please do|do it|go ahead|sounds good|let's do that|lets do that)\b/i.test(
      message.trim(),
    );

  const trajectoryLabel =
    asText(rawOutput.trajectoryLabel) ??
    (() => {
      const safeRoom = request?.context?.safeToSpendCents ?? request?.context?.budgetSafeRoomCents;
      if (typeof safeRoom === "number") {
        if (safeRoom < 0) {
          return "Pressure building";
        }
        if (safeRoom > 0) {
          return "Room intact";
        }
      }

      const snapshots = request?.context?.categorySnapshots ?? [];
      if (snapshots.some((snapshot) => snapshot.paceVsLastMonthPct >= 10)) {
        return "Pace rising";
      }
      if (snapshots.some((snapshot) => snapshot.paceVsLastMonthPct <= -10)) {
        return "Ahead of pace";
      }

      return typeof request?.context?.projectedEndCents === "number"
        ? request.context.projectedEndCents >= 0
          ? "Steady trajectory"
          : "Deficit watch"
        : null;
    })();

  const rawMetricCards = (rawOutput.metricCards ?? []).flatMap((card) => {
    const label = asText(card.label);
    const valueText = asText(card.valueText);
    const tone =
      card.tone === "positive" || card.tone === "neutral" || card.tone === "warning"
        ? card.tone
        : "neutral";
    if (!label || !valueText) {
      return [];
    }

    return [
      {
        id: asText(card.id) ?? slugify(label, "metric"),
        label,
        valueText,
        valueCents: toSignedCents(card.valueCents),
        tone,
      },
    ];
  });

  const normalizeBill = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    const bill = candidate as Record<string, unknown>;
    const name = asText(bill.name);
    const dueDateIso = asText(bill.dueDateIso);
    const amountCents = toCents(bill.amountCents);

    if (!name || !dueDateIso || amountCents === null || !isIsoDate(dueDateIso)) {
      return null;
    }

    return {
      name,
      amountCents,
      dueDateIso,
      isPaid: typeof bill.isPaid === "boolean" ? bill.isPaid : undefined,
      category: asText(bill.category),
      amountText: asText(bill.amountText) ?? formatCurrencyCents(amountCents),
    };
  };

  const nextBill =
    normalizeBill(rawOutput.nextBill) ??
    (() => {
      const bills = (request?.context?.upcomingBills ?? []).filter((bill) => bill.isPaid !== true);
      if (bills.length === 0) {
        return null;
      }

      const anchorDate =
        request?.context?.todayIso && isIsoDate(request.context.todayIso)
          ? request.context.todayIso
          : new Date().toISOString().slice(0, 10);

      const selected = [...bills].sort((left, right) => {
        const leftPriority = left.dueDateIso < anchorDate ? 0 : 1;
        const rightPriority = right.dueDateIso < anchorDate ? 0 : 1;

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.dueDateIso.localeCompare(right.dueDateIso);
      })[0];

      return selected
        ? {
            name: selected.name,
            amountCents: selected.amountCents,
            dueDateIso: selected.dueDateIso,
            isPaid: selected.isPaid,
            category: selected.category,
            amountText: formatCurrencyCents(selected.amountCents),
          }
        : null;
    })();

  const safeToSpendCents =
    toSignedCents(rawOutput.safeToSpendCents) ??
    request?.context?.safeToSpendCents ??
    request?.context?.budgetSafeRoomCents ??
    null;
  const projectedSurplusCents =
    toSignedCents(rawOutput.projectedSurplusCents) ?? request?.context?.projectedEndCents ?? null;

  const merchantContext =
    (() => {
      if (rawOutput.merchantContext) {
        const kind = asText(rawOutput.merchantContext.kind);
        const label = asText(rawOutput.merchantContext.label);
        const valueText = asText(rawOutput.merchantContext.valueText);
        const explanation = asText(rawOutput.merchantContext.explanation);
        if (kind && label && valueText && explanation) {
          return {
            kind,
            label,
            valueText,
            explanation,
          };
        }
      }

      const message = request?.message ?? "";
      const topic =
        /\b(dinner|lunch|restaurant|takeaway|meal|grocer|grocery|food)\b/i.test(message)
          ? {
              category: "Food & Dining",
              label: "Dinner budget",
              explanation: "Estimated from your recent dining history.",
            }
          : /\b(uber|taxi|transport|bus|train|fuel|petrol)\b/i.test(message)
            ? {
                category: "Transportation",
                label: "Transport guide",
                explanation: "Estimated from your recent transport history.",
              }
            : null;

      if (!topic) {
        return null;
      }

      const matches = (request?.context?.recentEvents ?? []).filter(
        (event) =>
          event.category?.toLowerCase() === topic.category.toLowerCase() ||
          event.title.toLowerCase().includes(topic.category.toLowerCase().split(" ")[0]),
      );
      if (matches.length === 0) {
        return null;
      }

      const estimatedAmountCents = Math.round(
        matches.reduce((sum, event) => sum + event.amountCents, 0) / matches.length,
      );

      return {
        kind: "habit_estimate",
        label: topic.label,
        valueText: formatCurrencyCents(estimatedAmountCents),
        explanation: topic.explanation,
      };
    })();

  let droppedActions = 0;
  const normalizedActions = (rawOutput.suggestedActions ?? []).flatMap((action) => {
    const strictDraft = draftActionSchema.safeParse(action.draftAction);

    if (!strictDraft.success) {
      droppedActions += 1;
      return [];
    }

    return [
      {
        title: action.title,
        reason: action.reason,
        draftAction: strictDraft.data,
      },
    ];
  });

  if (droppedActions > 0 && normalizedActions.length > 0) {
    warnings.push("One suggested action was omitted because it failed validation.");
  }

  const missingFields = Array.from(
    new Set((rawOutput.missingFields ?? []).map((f) => f.trim()).filter(Boolean)),
  );
  let needsReview =
    normalizedActions.length > 0 && ((rawOutput.needsReview ?? false) || warnings.length > 0);

  const todayDateIso = () => new Date().toISOString().slice(0, 10);
  const todayMonthKey = () => todayDateIso().slice(0, 7);

  const inferIntentForChat = (message: string): DraftAction["type"] | null => {
    const intent = inferIntentFromText(message);
    if (intent === "Unknown") {
      return null;
    }
    return intent;
  };

  const inferDefaultCategory = (intent: DraftAction["type"], message: string): string => {
    const lowered = message.toLowerCase();
    if (/travel|trip|flight|hotel|vacation/.test(lowered)) {
      return "Travel";
    }
    if (/transport|taxi|uber|bus|train|fuel|petrol/.test(lowered)) {
      return "Transportation";
    }
    if (/food|grocery|groceries|lunch|dinner|restaurant/.test(lowered)) {
      return "Food & Dining";
    }
    if (intent === "UpcomingBill") {
      return "Housing";
    }
    return "Uncategorized";
  };

  const buildDraftFromContext = (
    intent: DraftAction["type"] | null,
    candidate: Record<string, unknown>,
    message: string,
  ): { draft: DraftAction | null; essentialMissing: string[]; assumed: string[] } => {
    if (!intent) {
      return { draft: null, essentialMissing: [], assumed: [] };
    }

    const assumed: string[] = [];
    const essentialMissing: string[] = [];
    const monthKey =
      (asText(candidate.monthKey) && monthKeySchema.safeParse(candidate.monthKey).success
        ? asText(candidate.monthKey)
        : request?.context?.monthKey) ?? todayMonthKey();
    if (!candidate.monthKey && !request?.context?.monthKey) {
      assumed.push("Used current month for monthKey.");
    }

    const dateIso =
      (asText(candidate.dateIso) && isIsoDate(asText(candidate.dateIso) as string)
        ? asText(candidate.dateIso)
        : undefined) ?? todayDateIso();
    if (!candidate.dateIso) {
      assumed.push("Used today's date.");
    }

    const amountFromCandidate = toCents(candidate.amountCents);
    const amountFromMessage = extractAmountCentsFromText(message);
    const amountCents = amountFromCandidate ?? amountFromMessage;
    if (amountFromCandidate === null && amountFromMessage !== null) {
      assumed.push("Inferred amount from message.");
    }
    if (amountCents === null) {
      essentialMissing.push("amountCents");
    }

    const description =
      asText(candidate.description) ??
      asText(candidate.title) ??
      asText(candidate.notes) ??
      extractDescriptionFromInput(message) ??
      "Manual Draft";
    if (!candidate.description && !candidate.title && !candidate.notes) {
      assumed.push("Generated description from context.");
    }

    const category = asText(candidate.category) ?? inferDefaultCategory(intent, message);
    if (!candidate.category && ["Expense", "PlannedSpend", "UpcomingBill", "SplitExpense"].includes(intent)) {
      assumed.push("Set category using default mapping.");
    }

    if (intent === "PlannedSpend" || intent === "Expense") {
      if (amountCents === null) {
        return { draft: null, essentialMissing, assumed };
      }
      return {
        draft: {
          type: intent,
          amountCents,
          category,
          description,
          dateIso,
          monthKey,
        },
        essentialMissing,
        assumed,
      };
    }

    if (intent === "UpcomingBill") {
      if (amountCents === null) {
        return { draft: null, essentialMissing, assumed };
      }
      const recurrence =
        asText(candidate.recurrence) === "Weekly" ||
        asText(candidate.recurrence) === "Monthly" ||
        asText(candidate.recurrence) === "None"
          ? (asText(candidate.recurrence) as "None" | "Weekly" | "Monthly")
          : "None";
      if (!candidate.recurrence) {
        assumed.push("Set recurrence to None.");
      }
      return {
        draft: {
          type: "UpcomingBill",
          amountCents,
          category,
          description,
          dateIso,
          monthKey,
          recurrence,
        },
        essentialMissing,
        assumed,
      };
    }

    if (intent === "Income") {
      if (amountCents === null) {
        return { draft: null, essentialMissing, assumed };
      }
      const source = asText(candidate.source) ?? "Other";
      if (!candidate.source) {
        assumed.push("Set source to Other.");
      }
      return {
        draft: {
          type: "Income",
          amountCents,
          source,
          dateIso,
          monthKey,
        },
        essentialMissing,
        assumed,
      };
    }

    if (intent === "SplitExpense") {
      const person = asText(candidate.personName);
      if (!person) {
        return { draft: null, essentialMissing: ["personName"], assumed };
      }
      if (amountCents === null) {
        return { draft: null, essentialMissing, assumed };
      }
      const owedCents = toCents(candidate.owedCents) ?? Math.round(amountCents / 2);
      if (!candidate.owedCents) {
        assumed.push("Estimated owedCents as half the total.");
      }
      return {
        draft: {
          type: "SplitExpense",
          amountCents,
          category,
          description,
          dateIso,
          monthKey,
          personName: person,
          owedCents,
        },
        essentialMissing,
        assumed,
      };
    }

    if (intent === "DebtRepayment") {
      const person = asText(candidate.personName);
      if (!person) {
        return { draft: null, essentialMissing: ["personName"], assumed };
      }
      if (amountCents === null) {
        return { draft: null, essentialMissing, assumed };
      }
      return {
        draft: {
          type: "DebtRepayment",
          amountCents,
          personName: person,
          dateIso,
          monthKey,
        },
        essentialMissing,
        assumed,
      };
    }

    return { draft: null, essentialMissing, assumed };
  };

  const defaultCreateDraftLabel = (draft: DraftAction) => {
    switch (draft.type) {
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
  };

  const defaultCreateDraftIntent = (draft: DraftAction) => {
    switch (draft.type) {
      case "Expense":
        return "create_expense";
      case "Income":
        return "create_income";
      case "PlannedSpend":
        return "create_planned_spend";
      case "UpcomingBill":
        return "create_upcoming_bill";
      case "SplitExpense":
        return "create_split_expense";
      case "DebtRepayment":
        return "create_debt_repayment";
    }
  };

  const createDraftActionFromDraft = (
    draft: DraftAction,
    options?: { label?: string; intent?: string; target?: string },
  ) => {
    const targetMap: Record<DraftAction["type"], string> = {
      Expense: "expense",
      Income: "income",
      PlannedSpend: "planned_spend",
      UpcomingBill: "upcoming_bill",
      SplitExpense: "split_expense",
      DebtRepayment: "debt_repayment",
    };

    const payloadWithoutType = (() => {
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
    })();

    const suffix =
      (("description" in payloadWithoutType ? payloadWithoutType.description : undefined) ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32) || "draft";

    return {
      id: `create_${targetMap[draft.type]}_${suffix}`,
      label: options?.label ?? defaultCreateDraftLabel(draft),
      type: "create_draft" as const,
      target: options?.target ?? targetMap[draft.type],
      intent: options?.intent ?? defaultCreateDraftIntent(draft),
      draftType: draft.type,
      draftPayload: payloadWithoutType,
    };
  };

  type ModelUiAction = NonNullable<ChatModelOutput["uiActions"]>[number];

  const toStrictUiActionFromModel = (action: ModelUiAction) => {
    if (action.type === "open_input" && action.target) {
      return {
        id: action.id,
        label: action.label,
        type: "open_input" as const,
        target: action.target,
        intent: action.intent,
      };
    }

    if (
      action.type !== "create_draft" ||
      !action.target ||
      !action.draftType ||
      !action.draftPayload ||
      typeof action.draftPayload !== "object"
    ) {
      return null;
    }

    const combined = { type: action.draftType, ...action.draftPayload };
    const strict = draftActionSchema.safeParse(combined);
    if (!strict.success) {
      return null;
    }

    return createDraftActionFromDraft(strict.data, {
      label: action.label,
      intent: action.intent,
      target: action.target,
    });
  };

  const openInputLabelForField = (field: string) => {
    switch (field) {
      case "amount":
      case "amountCents":
      case "requestedAmountCents":
        return "Add amount";
      case "date":
      case "dateIso":
        return "Add date";
      case "category":
        return "Add category";
      case "personName":
        return "Add person";
      default:
        return "Add detail";
    }
  };

  const openInputIntentForField = (field: string) => {
    switch (field) {
      case "amount":
      case "amountCents":
      case "requestedAmountCents":
        return "ask_for_missing_amount";
      case "date":
      case "dateIso":
        return "ask_for_missing_date";
      case "category":
        return "ask_for_missing_category";
      case "personName":
        return "ask_for_missing_person";
      default:
        return "ask_for_missing_detail";
    }
  };

  let uiActions: Array<
    | {
        id: string;
        label: string;
        type: "open_input";
        target: string;
        intent?: string;
      }
    | {
        id: string;
        label: string;
        type: "create_draft";
        target: string;
        intent?: string;
        draftType: DraftAction["type"];
        draftPayload: Record<string, unknown>;
      }
  > = [];

  let inferredDraft: DraftAction | null = null;
  if (!inferredDraft && normalizedActions.length === 0 && rawOutput.pendingIntent) {
    const modelPendingCandidate =
      (rawOutput.pendingIntent.draftCandidate as Record<string, unknown> | undefined) ?? {};
    const modelPendingIntent =
      rawOutput.pendingIntent.intent !== "Unknown" ? rawOutput.pendingIntent.intent : null;
    const messageForInference = request?.message ?? rawOutput.reply;
    const built = buildDraftFromContext(modelPendingIntent, modelPendingCandidate, messageForInference);
    assumptions.push(...built.assumed);
    if (built.essentialMissing.length > 0) {
      missingFields.push(...built.essentialMissing);
    }
    inferredDraft = built.draft;
  }
  if (!inferredDraft && normalizedActions.length === 0 && request) {
    const candidate = (request.pendingIntent?.draftCandidate as Record<string, unknown> | undefined) ?? {};
    const intent =
      request.pendingIntent && request.pendingIntent.intent !== "Unknown"
        ? request.pendingIntent.intent
        : inferIntentForChat(request.message);
    const built = buildDraftFromContext(intent ?? null, candidate, request.message);
    assumptions.push(...built.assumed);
    if (built.essentialMissing.length > 0) {
      missingFields.push(...built.essentialMissing);
    }
    inferredDraft = built.draft;
  }

  const dedupedMissingFields = Array.from(new Set(missingFields));

  const hasHighRiskGap = dedupedMissingFields.includes("personName");
  const hasEssentialGap =
    dedupedMissingFields.includes("amountCents") ||
    dedupedMissingFields.includes("requestedAmountCents");

  if ((hasHighRiskGap || hasEssentialGap) && !inferredDraft && normalizedActions.length === 0) {
    uiActions = dedupedMissingFields.slice(0, 2).map((field) => ({
      id: `open_input_${field.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      label: openInputLabelForField(field),
      type: "open_input" as const,
      target: field,
      intent: openInputIntentForField(field),
    }));
  } else if (normalizedActions.length > 0) {
    uiActions = [createDraftActionFromDraft(normalizedActions[0].draftAction)];
    needsReview = true;
  } else if (inferredDraft) {
    uiActions = [createDraftActionFromDraft(inferredDraft)];
    needsReview = true;
  } else {
    const fromModel = (rawOutput.uiActions ?? [])
      .map((action) => toStrictUiActionFromModel(action))
      .filter((action): action is NonNullable<typeof action> => Boolean(action));

    uiActions = fromModel.length > 0 ? [fromModel[0]] : [];
    if (uiActions.some((a) => a.type === "create_draft")) {
      needsReview = true;
    }
  }

  const normalizeCta = (cta: unknown) => {
    if (!cta || typeof cta !== "object") {
      return null;
    }
    const candidate = cta as Record<string, unknown>;
    const label = asText(candidate.label);
    const type = asText(candidate.type);
    if (!label || !type) {
      return null;
    }

    return {
      id: asText(candidate.id) ?? `${type}_${slugify(label, "cta")}`,
      label,
      type,
      target: asText(candidate.target),
      intent: asText(candidate.intent),
      draftType:
        asText(candidate.draftType) &&
        ["Expense", "Income", "PlannedSpend", "UpcomingBill", "SplitExpense", "DebtRepayment"].includes(
          asText(candidate.draftType) as string,
        )
          ? (asText(candidate.draftType) as DraftAction["type"])
          : undefined,
      draftPayload:
        candidate.draftPayload && typeof candidate.draftPayload === "object"
          ? (candidate.draftPayload as Record<string, unknown>)
          : undefined,
    };
  };

  const ctaFromUiAction = (action: (typeof uiActions)[number]) => ({
    id: action.id,
    label: action.label,
    type: action.type,
    target: action.target,
    intent: action.intent,
    draftType: action.type === "create_draft" ? action.draftType : undefined,
    draftPayload: action.type === "create_draft" ? action.draftPayload : undefined,
  });

  const recommendationCard =
    (() => {
      const card = rawOutput.recommendationCard;
      if (card) {
        const title = asText(card.title);
        const body = asText(card.body);
        if (title && body) {
          return {
            eyebrow: asText(card.eyebrow),
            title,
            body,
            emphasisAmountText: asText(card.emphasisAmountText),
          };
        }
      }

      const safeRoom = safeToSpendCents;
      if (typeof safeRoom !== "number" || safeRoom <= 0) {
        return null;
      }

      const goals = (request?.context?.goalBalances ?? [])
        .map((goal) => ({
          label: goal.label,
          gapCents: goal.gapCents ?? Math.max(goal.targetCents - goal.currentCents, 0),
        }))
        .filter((goal) => goal.gapCents > 0)
        .sort((left, right) => left.gapCents - right.gapCents);

      const goal = goals[0];
      if (!goal) {
        return null;
      }

      const setAsideCents = Math.max(
        5000,
        Math.floor(Math.min(goal.gapCents, Math.max(25000, Math.min(safeRoom / 4, 100000))) / 5000) * 5000,
      );

      return {
        eyebrow: "Set-Aside Suggestion",
        title: `${goal.label} is ${formatCurrencyCents(goal.gapCents)} short of target.`,
        body: `Would you like me to prepare a ${formatCurrencyCents(setAsideCents)} set-aside while your current room is intact?`,
        emphasisAmountText: formatCurrencyCents(setAsideCents),
      };
    })();

  const completionState =
    (() => {
      if (!rawOutput.completionState) {
        return null;
      }
      const kind = asText(rawOutput.completionState.kind);
      const label = asText(rawOutput.completionState.label);
      const detail = asText(rawOutput.completionState.detail);
      if (!kind || !label) {
        return null;
      }
      return {
        kind,
        label,
        detail,
      };
    })();

  const affordability = request
    ? computeAffordability({ message: request.message, context: request.context })
    : null;
  const affordabilityStatus = affordability?.affordabilityCheck?.status ?? null;
  const hasDraftAction = uiActions.some((action) => action.type === "create_draft");
  const likelyConfirmation = request ? looksLikeConfirmation(request.message) : false;
  const warningSignal =
    affordabilityStatus === "tight" ||
    affordabilityStatus === "not_affordable" ||
    (typeof safeToSpendCents === "number" && safeToSpendCents < 0) ||
    (typeof projectedSurplusCents === "number" && projectedSurplusCents < 0) ||
    warnings.some((warning) => /\btight|risk|caution|over|insufficient|short\b/i.test(warning));

  const deriveStatus = () => {
    if (rawOutput.status === "needs_detail" || rawOutput.status === "warning") {
      return rawOutput.status;
    }
    if (rawOutput.status === "briefing" && !hasDraftAction) {
      return rawOutput.status;
    }
    if (rawOutput.status === "action_confirmation" || rawOutput.status === "draft_creation" || rawOutput.status === "completed" || rawOutput.status === "error") {
      return rawOutput.status;
    }
    if (completionState) {
      return "completed" as const;
    }
    if (dedupedMissingFields.length > 0) {
      return "needs_detail" as const;
    }
    if (likelyConfirmation && hasDraftAction && request?.pendingIntent?.missingFields?.length === 0) {
      return "action_confirmation" as const;
    }
    if (hasDraftAction) {
      return "draft_creation" as const;
    }
    if (warningSignal || rawOutput.status === "review_required") {
      return "warning" as const;
    }
    return "briefing" as const;
  };

  const status = deriveStatus();
  if (status === "completed") {
    needsReview = false;
  } else if (hasDraftAction) {
    needsReview = true;
  }

  const responseMode =
    rawOutput.responseMode ??
    (() => {
      switch (status) {
        case "needs_detail":
          return "clarify" as const;
        case "warning":
          return "caution" as const;
        case "action_confirmation":
        case "draft_creation":
          return "propose_action" as const;
        case "completed":
          return "completed" as const;
        case "error":
          return "error" as const;
        default:
          return hasDraftAction || recommendationCard ? ("propose_action" as const) : ("briefing" as const);
      }
    })();

  const metricCards =
    rawMetricCards.length > 0
      ? rawMetricCards
      : (() => {
          const cards: Array<{
            id: string;
            label: string;
            valueText: string;
            valueCents: number | null;
            tone: "positive" | "neutral" | "warning";
          }> = [];

          if (typeof projectedSurplusCents === "number") {
            cards.push({
              id: "projected_surplus",
              label: "Projected Surplus",
              valueText: formatCurrencyCents(projectedSurplusCents),
              valueCents: projectedSurplusCents,
              tone: projectedSurplusCents >= 0 ? "positive" : "warning",
            });
          }

          if (typeof safeToSpendCents === "number") {
            cards.push({
              id: "safe_to_spend",
              label: "Safe to Spend",
              valueText: formatCurrencyCents(safeToSpendCents),
              valueCents: safeToSpendCents,
              tone: safeToSpendCents > 0 ? "positive" : safeToSpendCents < 0 ? "warning" : "neutral",
            });
          }

          if (nextBill) {
            cards.push({
              id: "next_bill",
              label: `Next Debit (${nextBill.dueDateIso.slice(8, 10)})`,
              valueText: nextBill.amountText,
              valueCents: nextBill.amountCents,
              tone: "warning",
            });
          }

          return cards.slice(0, 3);
        })();

  const primaryCta =
    normalizeCta(rawOutput.primaryCta) ?? (uiActions[0] ? ctaFromUiAction(uiActions[0]) : null);
  const secondaryCta =
    normalizeCta(rawOutput.secondaryCta) ??
    (primaryCta && recommendationCard
      ? {
          id: "maybe_later",
          label: "Maybe later",
          type: "dismiss_recommendation",
          target: "recommendation_card",
          intent: "dismiss_recommendation",
          draftType: undefined,
          draftPayload: undefined,
        }
      : null);

  const deriveTrendNarrative = () => {
    const snapshots = request?.context?.categorySnapshots ?? [];
    const notable = [...snapshots].sort(
      (left, right) => Math.abs(right.paceVsLastMonthPct) - Math.abs(left.paceVsLastMonthPct),
    )[0];
    if (!notable) {
      return null;
    }

    if (notable.paceVsLastMonthPct <= -5) {
      return `${notable.category} is tracking ${Math.abs(Math.round(notable.paceVsLastMonthPct))}% below last month.`;
    }
    if (notable.paceVsLastMonthPct >= 5) {
      return `${notable.category} is tracking ${Math.round(notable.paceVsLastMonthPct)}% above last month.`;
    }

    return null;
  };

  const insightLabel =
    asText(rawOutput.insightLabel) ??
    (() => {
      switch (status) {
        case "needs_detail":
          return "One Detail Needed";
        case "warning":
          return "Spending Caution";
        case "action_confirmation":
        case "draft_creation":
          return "Next Step";
        case "completed":
          return completionState?.label ?? "Update Complete";
        default:
          return trajectoryLabel ?? "Trajectory Analysis";
      }
    })();

  const headline =
    asText(rawOutput.headline) ??
    (() => {
      if (status === "needs_detail") {
        return "I need one detail before I line this up.";
      }
      if (status === "warning" && typeof safeToSpendCents === "number") {
        return `This looks tight against your remaining room of ${formatCurrencyCents(safeToSpendCents)}.`;
      }
      if ((status === "action_confirmation" || status === "draft_creation") && hasDraftAction) {
        return "I can prepare this for review now.";
      }
      if (status === "completed") {
        return completionState?.detail
          ? `${completionState.label}. ${completionState.detail}`
          : `${completionState?.label ?? "Update complete"}.`;
      }
      if (typeof safeToSpendCents === "number" && nextBill) {
        return `You have ${formatCurrencyCents(safeToSpendCents)} of room before ${nextBill.name}.`;
      }
      if (typeof projectedSurplusCents === "number") {
        return `You are tracking toward ${formatCurrencyCents(projectedSurplusCents)} at month-end.`;
      }
      return rawOutput.reply;
    })();

  const supportingBody =
    asText(rawOutput.supportingBody) ??
    (() => {
      if (status === "needs_detail") {
        return "Once I have that, I can check it against your current spend room and prepare the right draft.";
      }
      const trendNarrative = deriveTrendNarrative();
      if (trendNarrative && nextBill) {
        return `${trendNarrative} Your next unpaid bill is ${nextBill.name} for ${nextBill.amountText}.`;
      }
      if (trendNarrative) {
        return trendNarrative;
      }
      if (nextBill) {
        return `${nextBill.name} is still pending for ${nextBill.amountText} on ${nextBill.dueDateIso}.`;
      }
      return null;
    })();

  const advisorNote =
    asText(rawOutput.advisorNote) ??
    (() => {
      if (merchantContext) {
        return `${merchantContext.label} is an estimate. Treat it as a guide rather than a ceiling.`;
      }
      if (assumptions.length > 0 || warnings.length > 0) {
        return "Treat this as a planning view until the underlying details are fully confirmed.";
      }
      return null;
    })();

  const coachPrompt =
    asText(rawOutput.coachPrompt) ??
    (() => {
      if (status === "needs_detail") {
        return "Share the missing detail and I will line it up against your current room.";
      }
      if (primaryCta) {
        return "If you want, I can prepare the next step for review.";
      }
      return null;
    })();

  const derivePendingIntent = () => {
    if (status === "completed") {
      return null;
    }

    if (rawOutput.pendingIntent) {
      return {
        intent: rawOutput.pendingIntent.intent,
        missingFields: Array.from(new Set(rawOutput.pendingIntent.missingFields)),
        draftCandidate: rawOutput.pendingIntent.draftCandidate ?? {},
      };
    }

    const requestPending = request?.pendingIntent;
    const draftCandidateFromAction = normalizedActions[0]?.draftAction ?? inferredDraft;
    const createDraftAction = uiActions.find((action) => action.type === "create_draft");

    if (status === "needs_detail" || dedupedMissingFields.length > 0) {
      const inferredIntent =
        draftCandidateFromAction?.type ?? requestPending?.intent ?? ("Unknown" as const);

      return {
        intent: inferredIntent,
        missingFields: dedupedMissingFields,
        draftCandidate:
          (createDraftAction && createDraftAction.type === "create_draft"
            ? createDraftAction.draftPayload
            : draftCandidateFromAction ?? requestPending?.draftCandidate) ?? {},
      };
    }

    if (createDraftAction && createDraftAction.type === "create_draft") {
      return {
        intent: createDraftAction.draftType,
        missingFields: [],
        draftCandidate: createDraftAction.draftPayload,
      };
    }

    return null;
  };

  const pendingIntent = derivePendingIntent();
  const dedupedWarnings = dedupeWarnings(warnings);

  return chatDataSchema.parse({
    status,
    responseMode,
    confidence: Math.max(
      0,
      Math.min(
        1,
        rawOutput.confidence ??
          (hasDraftAction ? 0.78 : status === "needs_detail" ? 0.72 : status === "warning" ? 0.74 : 0.88),
      ),
    ),
    tone: asText(rawOutput.tone) ?? "calm_premium",
    reply: rawOutput.reply,
    insightLabel,
    trajectoryLabel,
    headline,
    supportingBody,
    advisorNote,
    safeToSpendCents,
    projectedSurplusCents,
    nextBill,
    metricCards,
    merchantContext,
    coachPrompt,
    recommendationCard,
    primaryCta,
    secondaryCta,
    uiActions,
    suggestedActions: normalizedActions,
    needsReview,
    missingFields: dedupedMissingFields,
    pendingIntent,
    assumptions: dedupeStrings(assumptions),
    warnings: dedupedWarnings,
    completionState,
  });
}

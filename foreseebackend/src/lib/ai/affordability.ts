import type { ChatRequest } from "@/lib/ai/schemas";

export type AffordabilityStatus = "affordable" | "tight" | "not_affordable";

export type AffordabilityCheck = {
  status: AffordabilityStatus;
  requestedAmountCents: number;
  projectedEndCents: number | null;
  safeToSpendCents: number | null;
  remainingAfterCents: number;
  evaluatedAgainst: "safe_to_spend" | "projected_end";
  basis: string;
};

export type AffordabilityResult = {
  affordabilityCheck: AffordabilityCheck | null;
  missingFields: string[];
};

function parseMoneyToCents(raw: string): number | null {
  const normalized = raw.replace(/[\s,]/g, "");

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [whole, fractional = ""] = normalized.split(".");
  const wholeNum = Number(whole);

  if (!Number.isFinite(wholeNum)) {
    return null;
  }

  const cents = Number((fractional + "00").slice(0, 2));
  return wholeNum * 100 + cents;
}

export function extractRequestedAmountCents(message: string): number | null {
  const shortK = message.match(/(?:r|zar)?\s*(\d+(?:\.\d+)?)\s*k\b/i);
  if (shortK?.[1]) {
    const value = Number(shortK[1]);
    if (Number.isFinite(value)) {
      return Math.round(value * 1000 * 100);
    }
  }

  const currencyMatch = message.match(/(?:r|zar)\s*([\d][\d\s,]*(?:\.\d{1,2})?)/i);

  if (currencyMatch?.[1]) {
    return parseMoneyToCents(currencyMatch[1]);
  }

  const aroundTripMatch = message.match(
    /(?:trip|travel|budget|spend|cost|set\s+aside)\D{0,20}(\d[\d\s,]*(?:\.\d{1,2})?)/i,
  );

  if (aroundTripMatch?.[1]) {
    return parseMoneyToCents(aroundTripMatch[1]);
  }

  return null;
}

export function computeAffordability(input: {
  message: string;
  context?: ChatRequest["context"];
}): AffordabilityResult {
  const requestedAmountCents = extractRequestedAmountCents(input.message);
  const projectedEndCents = input.context?.projectedEndCents;
  const safeToSpendCents = input.context?.safeToSpendCents ?? input.context?.budgetSafeRoomCents;

  const missingFields: string[] = [];

  if (requestedAmountCents === null) {
    missingFields.push("requestedAmountCents");
  }

  if (typeof safeToSpendCents !== "number" && typeof projectedEndCents !== "number") {
    missingFields.push("safeToSpendCents");
    missingFields.push("projectedEndCents");
  }

  if (missingFields.length > 0) {
    return {
      affordabilityCheck: null,
      missingFields,
    };
  }

  const baselineCents =
    typeof safeToSpendCents === "number"
      ? safeToSpendCents
      : typeof projectedEndCents === "number"
        ? projectedEndCents
        : null;

  if (requestedAmountCents === null || baselineCents === null) {
    return {
      affordabilityCheck: null,
      missingFields: ["requestedAmountCents", "safeToSpendCents", "projectedEndCents"],
    };
  }

  const remainingAfterCents = baselineCents - requestedAmountCents;
  const tightThreshold = Math.max(50000, Math.round(requestedAmountCents * 0.1));

  let status: AffordabilityStatus;
  if (remainingAfterCents < 0) {
    status = "not_affordable";
  } else if (remainingAfterCents <= tightThreshold) {
    status = "tight";
  } else {
    status = "affordable";
  }

  return {
    affordabilityCheck: {
      status,
      requestedAmountCents,
      projectedEndCents: typeof projectedEndCents === "number" ? projectedEndCents : null,
      safeToSpendCents: typeof safeToSpendCents === "number" ? safeToSpendCents : null,
      remainingAfterCents,
      evaluatedAgainst:
        typeof safeToSpendCents === "number" ? "safe_to_spend" : "projected_end",
      basis:
        typeof safeToSpendCents === "number"
          ? "Deterministic rule: remainingAfterCents = safeToSpendCents - requestedAmountCents."
          : "Deterministic rule: remainingAfterCents = projectedEndCents - requestedAmountCents.",
    },
    missingFields: [],
  };
}

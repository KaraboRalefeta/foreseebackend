import { describe, expect, it } from "vitest";

import { computeAffordability, extractRequestedAmountCents } from "./affordability";

describe("extractRequestedAmountCents", () => {
  it("extracts ZAR currency amount", () => {
    const cents = extractRequestedAmountCents("trip costs R2,000 on Saturday");
    expect(cents).toBe(200000);
  });

  it("extracts decimal amount", () => {
    const cents = extractRequestedAmountCents("budget zar 199.50 for groceries");
    expect(cents).toBe(19950);
  });

  it("extracts shorthand k amount", () => {
    const cents = extractRequestedAmountCents("trip budget is 2k");
    expect(cents).toBe(200000);
  });
});

describe("computeAffordability", () => {
  it("prefers safe-to-spend room when it is available", () => {
    const result = computeAffordability({
      message: "Dinner is R850",
      context: { projectedEndCents: 500000, safeToSpendCents: 240000 },
    });

    expect(result.affordabilityCheck?.evaluatedAgainst).toBe("safe_to_spend");
    expect(result.affordabilityCheck?.remainingAfterCents).toBe(155000);
  });

  it("uses projected balance but marks risk unknown when safe-to-spend is missing", () => {
    const result = computeAffordability({
      message: "Trip is R2000",
      context: { projectedEndCents: 324000 },
    });

    expect(result.affordabilityCheck?.status).toBe("unknown");
    expect(result.affordabilityCheck?.remainingAfterCents).toBe(124000);
    expect(result.missingFields).toHaveLength(0);
  });

  it("returns low risk when requested amount is under 40% of safe-to-spend", () => {
    const result = computeAffordability({
      message: "Transport is R700",
      context: { projectedEndCents: 586000, safeToSpendCents: 280000 },
    });

    expect(result.affordabilityCheck?.status).toBe("low");
    expect(result.affordabilityCheck?.safeToSpendAfterCents).toBe(210000);
    expect(result.affordabilityCheck?.projectedEndAfterCents).toBe(516000);
    expect(result.affordabilityCheck?.isAffordable).toBe(true);
  });

  it("returns moderate risk when requested amount is under 75% of safe-to-spend", () => {
    const result = computeAffordability({
      message: "Trip is R1500",
      context: { projectedEndCents: 400000, safeToSpendCents: 250000 },
    });

    expect(result.affordabilityCheck?.status).toBe("moderate");
  });

  it("returns tight when remaining is positive but low", () => {
    const result = computeAffordability({
      message: "Trip is R2000",
      context: { projectedEndCents: 205000, safeToSpendCents: 205000 },
    });

    expect(result.affordabilityCheck?.status).toBe("tight");
    expect(result.affordabilityCheck?.remainingAfterCents).toBe(5000);
  });

  it("returns risky when remaining is negative", () => {
    const result = computeAffordability({
      message: "Trip is R2000",
      context: { projectedEndCents: 150000, safeToSpendCents: 150000 },
    });

    expect(result.affordabilityCheck?.status).toBe("risky");
    expect(result.affordabilityCheck?.remainingAfterCents).toBe(-50000);
  });

  it("returns missing fields when required affordability inputs are unavailable", () => {
    const result = computeAffordability({
      message: "Can I afford this trip?",
      context: {},
    });

    expect(result.affordabilityCheck).toBeNull();
    expect(result.missingFields).toContain("requestedAmountCents");
    expect(result.missingFields).toContain("safeToSpendCents");
    expect(result.missingFields).toContain("projectedEndCents");
  });
});

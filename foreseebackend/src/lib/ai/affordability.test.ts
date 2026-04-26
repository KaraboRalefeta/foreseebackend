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

  it("returns affordable when enough projected balance remains", () => {
    const result = computeAffordability({
      message: "Trip is R2000",
      context: { projectedEndCents: 324000 },
    });

    expect(result.affordabilityCheck?.status).toBe("affordable");
    expect(result.affordabilityCheck?.remainingAfterCents).toBe(124000);
    expect(result.missingFields).toHaveLength(0);
  });

  it("returns tight when remaining is positive but low", () => {
    const result = computeAffordability({
      message: "Trip is R2000",
      context: { projectedEndCents: 205000 },
    });

    expect(result.affordabilityCheck?.status).toBe("tight");
    expect(result.affordabilityCheck?.remainingAfterCents).toBe(5000);
  });

  it("returns not_affordable when remaining is negative", () => {
    const result = computeAffordability({
      message: "Trip is R2000",
      context: { projectedEndCents: 150000 },
    });

    expect(result.affordabilityCheck?.status).toBe("not_affordable");
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

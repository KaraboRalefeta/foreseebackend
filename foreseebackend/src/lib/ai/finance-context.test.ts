import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseRestMock } = vi.hoisted(() => ({
  supabaseRestMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseRest: supabaseRestMock,
}));

import { supabaseRest } from "@/lib/supabase/client";

import { loadMonthlyFinanceContext } from "./finance-context";

describe("loadMonthlyFinanceContext", () => {
  beforeEach(() => {
    supabaseRestMock.mockReset();
    supabaseRestMock.mockImplementation((table: string) => {
      switch (table) {
        case "transactions":
          return Promise.resolve([
            {
              amount_cents: 12000,
              category: "Food",
              description: "Lunch",
              date_iso: "2026-04-20",
              kind: "Expense",
              month_key: "2026-04",
            },
          ]);
        case "income":
          return Promise.resolve([
            {
              source: "Salary",
              expected_cents: 100000,
              received_cents: 80000,
              date_iso: "2026-04-01",
              month_key: "2026-04",
            },
          ]);
        case "budget_categories":
          return Promise.resolve([
            {
              name: "Food",
              limit_cents: 30000,
              sort_order: 0,
            },
          ]);
        case "planned_spending":
          return Promise.resolve([
            {
              category: "Food",
              description: "Groceries",
              amount_cents: 10000,
              date_iso: "2026-04-25",
              month_key: "2026-04",
              is_committed: true,
            },
          ]);
        case "upcoming_payments":
          return Promise.resolve([
            {
              category: "Bills",
              description: "Subscription",
              amount_cents: 5000,
              date_iso: "2026-04-30",
              month_key: "2026-04",
              is_paid: false,
            },
          ]);
        default:
          return Promise.resolve([]);
      }
    });
  });

  it("aggregates monthly finance context and filters out soft-deleted rows", async () => {
    const context = await loadMonthlyFinanceContext({
      user: { id: "user_123" },
      monthKey: "2026-04",
    });

    expect(context.incomeExpectedCents).toBe(100000);
    expect(context.incomeReceivedCents).toBe(80000);
    expect(context.availableCashCents).toBe(68000);
    expect(context.projectedEndCents).toBe(73000);
    expect(context.budgetSafeRoomCents).toBe(8000);
    expect(context.safeToSpendCents).toBe(8000);
    expect(context.upcomingBills[0]?.name).toBe("Subscription");
    expect(context.categorySnapshots[0]).toMatchObject({
      category: "Food",
      spentCents: 12000,
      budgetCents: 30000,
    });

    for (const call of vi.mocked(supabaseRest).mock.calls) {
      expect(call[1]?.query).toMatchObject({
        deleted_at: "is.null",
      });
    }
  });
});

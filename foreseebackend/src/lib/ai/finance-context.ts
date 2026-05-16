import type { ChatRequest } from "@/lib/ai/schemas";
import type { AuthenticatedUser } from "@/lib/auth/clerk";
import { supabaseRest } from "@/lib/supabase/client";

type TransactionRow = {
  amount_cents: number;
  category: string;
  description: string;
  date_iso: string;
  kind: string;
  month_key: string;
};

type IncomeRow = {
  source: string;
  expected_cents: number;
  received_cents: number;
  date_iso: string;
  month_key: string;
};

type BudgetCategoryRow = {
  name: string;
  limit_cents: number;
  sort_order: number;
};

type PlannedSpendingRow = {
  category: string;
  description: string;
  amount_cents: number;
  date_iso: string;
  month_key: string;
  is_committed: boolean;
};

type UpcomingPaymentRow = {
  category: string;
  description: string;
  amount_cents: number;
  date_iso: string;
  month_key: string;
  is_paid: boolean;
};

const DEFAULT_CURRENCY = "ZAR";
const DEFAULT_LOCALE = "en-ZA";
const DEFAULT_TIMEZONE = "Africa/Johannesburg";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function minSigned(values: Array<number | null | undefined>): number | undefined {
  const numeric = values.filter((value): value is number => typeof value === "number");
  return numeric.length > 0 ? Math.min(...numeric) : undefined;
}

async function readMonthlyRows<T>(
  table: string,
  user: AuthenticatedUser,
  monthKey: string,
  select: string,
): Promise<T[]> {
  return supabaseRest<T[]>(table, {
    method: "GET",
    query: {
      select,
      user_id: `eq.${user.id}`,
      month_key: `eq.${monthKey}`,
      deleted_at: "is.null",
    },
  });
}

export async function loadMonthlyFinanceContext(params: {
  user: AuthenticatedUser;
  monthKey: string;
  currency?: string;
  locale?: string;
  timezone?: string;
}): Promise<NonNullable<ChatRequest["context"]>> {
  const { user, monthKey } = params;
  const [transactions, income, budgetCategories, plannedSpending, upcomingPayments] =
    await Promise.all([
      readMonthlyRows<TransactionRow>(
        "transactions",
        user,
        monthKey,
        "amount_cents,category,description,date_iso,kind,month_key",
      ),
      readMonthlyRows<IncomeRow>(
        "income",
        user,
        monthKey,
        "source,expected_cents,received_cents,date_iso,month_key",
      ),
      readMonthlyRows<BudgetCategoryRow>(
        "budget_categories",
        user,
        monthKey,
        "name,limit_cents,sort_order",
      ),
      readMonthlyRows<PlannedSpendingRow>(
        "planned_spending",
        user,
        monthKey,
        "category,description,amount_cents,date_iso,month_key,is_committed",
      ),
      readMonthlyRows<UpcomingPaymentRow>(
        "upcoming_payments",
        user,
        monthKey,
        "category,description,amount_cents,date_iso,month_key,is_paid",
      ),
    ]);

  const incomeExpectedCents = sum(income.map((row) => row.expected_cents));
  const incomeReceivedCents = sum(income.map((row) => row.received_cents));
  const actualExpenseCents = sum(transactions.map((row) => row.amount_cents));
  const committedPlannedCents = sum(
    plannedSpending.filter((row) => row.is_committed).map((row) => row.amount_cents),
  );
  const unpaidUpcomingBillsCents = sum(
    upcomingPayments.filter((row) => !row.is_paid).map((row) => row.amount_cents),
  );
  const totalBudgetLimitCents = sum(budgetCategories.map((row) => row.limit_cents));
  const availableCashCents = incomeReceivedCents - actualExpenseCents;
  const projectedEndCents =
    incomeExpectedCents - actualExpenseCents - committedPlannedCents - unpaidUpcomingBillsCents;
  const budgetSafeRoomCents = totalBudgetLimitCents - actualExpenseCents - committedPlannedCents;
  const safeToSpendCents = minSigned([
    availableCashCents,
    projectedEndCents,
    totalBudgetLimitCents > 0 ? budgetSafeRoomCents : undefined,
  ]);

  const spentByCategory = new Map<string, number>();
  for (const row of transactions) {
    spentByCategory.set(row.category, (spentByCategory.get(row.category) ?? 0) + row.amount_cents);
  }

  const categorySnapshots = budgetCategories
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((category) => {
      const spentCents = spentByCategory.get(category.name) ?? 0;
      return {
        category: category.name,
        spentCents,
        budgetCents: category.limit_cents,
        paceVsLastMonthPct:
          category.limit_cents > 0
            ? Math.round(((spentCents - category.limit_cents / 2) / category.limit_cents) * 100)
            : 0,
      };
    });

  const upcomingBills = upcomingPayments
    .filter((row) => !row.is_paid)
    .sort((left, right) => left.date_iso.localeCompare(right.date_iso))
    .slice(0, 12)
    .map((row) => ({
      name: row.description,
      amountCents: row.amount_cents,
      dueDateIso: row.date_iso,
      isPaid: row.is_paid,
      category: row.category,
    }));

  const recentEvents = [
    ...transactions.map((row) => ({
      title: row.description,
      amountCents: row.amount_cents,
      dateIso: row.date_iso,
      type: "expense" as const,
      category: row.category,
    })),
    ...income.map((row) => ({
      title: row.source,
      amountCents: row.received_cents,
      dateIso: row.date_iso,
      type: "income" as const,
      category: "Income",
    })),
    ...plannedSpending.map((row) => ({
      title: row.description,
      amountCents: row.amount_cents,
      dateIso: row.date_iso,
      type: "planned" as const,
      category: row.category,
    })),
    ...upcomingPayments.map((row) => ({
      title: row.description,
      amountCents: row.amount_cents,
      dateIso: row.date_iso,
      type: "bill" as const,
      category: row.category,
    })),
  ]
    .sort((left, right) => right.dateIso.localeCompare(left.dateIso))
    .slice(0, 12);

  return {
    monthKey,
    currency: params.currency ?? DEFAULT_CURRENCY,
    locale: params.locale ?? DEFAULT_LOCALE,
    timezone: params.timezone ?? DEFAULT_TIMEZONE,
    todayIso: todayIso(),
    projectedEndCents,
    safeToSpendCents,
    availableCashCents,
    incomeExpectedCents,
    incomeReceivedCents,
    totalBudgetLimitCents,
    budgetSafeRoomCents,
    upcomingBills,
    goalBalances: [],
    categorySnapshots,
    recentEvents,
  };
}

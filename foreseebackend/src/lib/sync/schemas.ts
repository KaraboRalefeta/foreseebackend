import { z } from "zod";

const monthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "monthKey must be YYYY-MM");

const dateIsoSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "dateIso must be YYYY-MM-DD");

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "timestamp must be a valid ISO-8601 date-time",
});

const uuidSchema = z.string().uuid();
const textSchema = z.string().max(500);
const requiredTextSchema = textSchema.min(1);
const positiveCentsSchema = z.number().int().positive();
const nonnegativeCentsSchema = z.number().int().nonnegative();

export const entityTypeSchema = z.enum([
  "transaction",
  "transactions",
  "income",
  "budgetCategory",
  "budgetCategories",
  "budget_category",
  "budget_categories",
  "plannedSpending",
  "planned_spending",
  "upcomingPayment",
  "upcomingPayments",
  "upcoming_payment",
  "upcoming_payments",
  "debt",
  "debts",
]);

export const changeOperationSchema = z.enum(["upsert", "delete"]);

const transactionPayloadSchema = z.object({
  amountCents: positiveCentsSchema,
  category: requiredTextSchema,
  description: textSchema.default(""),
  dateIso: dateIsoSchema,
  monthKey: monthKeySchema,
  kind: z.enum(["Expense", "SplitExpense", "DebtRepayment"]),
  linkedDebtId: uuidSchema.nullable().optional(),
});

const incomePayloadSchema = z.object({
  source: requiredTextSchema,
  expectedCents: nonnegativeCentsSchema,
  receivedCents: nonnegativeCentsSchema,
  dateIso: dateIsoSchema,
  monthKey: monthKeySchema,
});

const budgetCategoryPayloadSchema = z.object({
  name: requiredTextSchema,
  limitCents: nonnegativeCentsSchema,
  iconKey: requiredTextSchema,
  accentKey: requiredTextSchema,
  sortOrder: z.number().int(),
});

const plannedSpendingPayloadSchema = z.object({
  category: requiredTextSchema,
  description: textSchema.default(""),
  amountCents: positiveCentsSchema,
  dateIso: dateIsoSchema,
  monthKey: monthKeySchema,
  isCommitted: z.boolean().default(true),
});

const upcomingPaymentPayloadSchema = z.object({
  category: requiredTextSchema,
  description: textSchema.default(""),
  amountCents: positiveCentsSchema,
  dateIso: dateIsoSchema,
  monthKey: monthKeySchema,
  isPaid: z.boolean().default(false),
  recurrenceLabel: textSchema.nullable().optional(),
});

const debtPayloadSchema = z.object({
  personName: requiredTextSchema,
  description: textSchema.default(""),
  amountCents: positiveCentsSchema,
  direction: z.enum(["OwesYou", "YouOwe"]),
  status: z.enum(["Open", "Settled"]),
  createdDateIso: dateIsoSchema,
  monthKey: monthKeySchema,
  settledDateIso: dateIsoSchema.nullable().optional(),
  linkedTransactionId: uuidSchema.nullable().optional(),
});

export const payloadSchemas = {
  transactions: transactionPayloadSchema,
  income: incomePayloadSchema,
  budgetCategories: budgetCategoryPayloadSchema,
  plannedSpending: plannedSpendingPayloadSchema,
  upcomingPayments: upcomingPaymentPayloadSchema,
  debts: debtPayloadSchema,
} as const;

export const syncChangeSchema = z.object({
  entityType: entityTypeSchema,
  operation: changeOperationSchema,
  entityId: uuidSchema,
  clientUpdatedAt: timestampSchema,
  payload: z.unknown().optional(),
});

export const syncPushRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
  changes: z.array(syncChangeSchema).max(500),
});

export const syncExchangeRequestSchema = syncPushRequestSchema.extend({
  since: timestampSchema.optional(),
});

export type EntityCollection =
  | "transactions"
  | "income"
  | "budgetCategories"
  | "plannedSpending"
  | "upcomingPayments"
  | "debts";

export type SyncChange = z.infer<typeof syncChangeSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncExchangeRequest = z.infer<typeof syncExchangeRequestSchema>;

export function normalizeEntityType(entityType: z.infer<typeof entityTypeSchema>): EntityCollection {
  switch (entityType) {
    case "transaction":
    case "transactions":
      return "transactions";
    case "income":
      return "income";
    case "budgetCategory":
    case "budgetCategories":
    case "budget_category":
    case "budget_categories":
      return "budgetCategories";
    case "plannedSpending":
    case "planned_spending":
      return "plannedSpending";
    case "upcomingPayment":
    case "upcomingPayments":
    case "upcoming_payment":
    case "upcoming_payments":
      return "upcomingPayments";
    case "debt":
    case "debts":
      return "debts";
  }
}

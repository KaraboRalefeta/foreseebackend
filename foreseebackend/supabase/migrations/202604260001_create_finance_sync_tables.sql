create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  category text not null check (length(trim(category)) > 0),
  description text not null,
  date_iso date not null,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  kind text not null check (kind in ('Expense', 'SplitExpense', 'DebtRepayment')),
  linked_debt_id uuid null,
  client_updated_at timestamptz null,
  last_modified_device_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.income (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (length(trim(source)) > 0),
  expected_cents bigint not null check (expected_cents >= 0),
  received_cents bigint not null check (received_cents >= 0),
  date_iso date not null,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  client_updated_at timestamptz null,
  last_modified_device_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  limit_cents bigint not null check (limit_cents >= 0),
  icon_key text not null,
  accent_key text not null,
  sort_order int not null default 0,
  client_updated_at timestamptz null,
  last_modified_device_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.planned_spending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  date_iso date not null,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  is_committed boolean not null default true,
  client_updated_at timestamptz null,
  last_modified_device_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.upcoming_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  date_iso date not null,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  is_paid boolean not null default false,
  recurrence_label text null,
  client_updated_at timestamptz null,
  last_modified_device_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_name text not null check (length(trim(person_name)) > 0),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  direction text not null check (direction in ('OwesYou', 'YouOwe')),
  status text not null check (status in ('Open', 'Settled')),
  created_date_iso date not null,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  settled_date_iso date null,
  linked_transaction_id uuid null,
  client_updated_at timestamptz null,
  last_modified_device_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists transactions_user_updated_idx on public.transactions (user_id, updated_at);
create index if not exists transactions_user_month_idx on public.transactions (user_id, month_key);
create index if not exists transactions_user_deleted_idx on public.transactions (user_id, deleted_at);
create index if not exists transactions_linked_debt_idx on public.transactions (linked_debt_id);

create index if not exists income_user_updated_idx on public.income (user_id, updated_at);
create index if not exists income_user_month_idx on public.income (user_id, month_key);
create index if not exists income_user_deleted_idx on public.income (user_id, deleted_at);

create index if not exists budget_categories_user_updated_idx on public.budget_categories (user_id, updated_at);
create index if not exists budget_categories_user_month_idx on public.budget_categories (user_id, sort_order);
create index if not exists budget_categories_user_deleted_idx on public.budget_categories (user_id, deleted_at);

create index if not exists planned_spending_user_updated_idx on public.planned_spending (user_id, updated_at);
create index if not exists planned_spending_user_month_idx on public.planned_spending (user_id, month_key);
create index if not exists planned_spending_user_deleted_idx on public.planned_spending (user_id, deleted_at);

create index if not exists upcoming_payments_user_updated_idx on public.upcoming_payments (user_id, updated_at);
create index if not exists upcoming_payments_user_month_idx on public.upcoming_payments (user_id, month_key);
create index if not exists upcoming_payments_user_deleted_idx on public.upcoming_payments (user_id, deleted_at);

create index if not exists debts_user_updated_idx on public.debts (user_id, updated_at);
create index if not exists debts_user_month_idx on public.debts (user_id, month_key);
create index if not exists debts_user_deleted_idx on public.debts (user_id, deleted_at);
create index if not exists debts_linked_transaction_idx on public.debts (linked_transaction_id);

drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at before update on public.transactions
for each row execute function public.set_updated_at();

drop trigger if exists set_income_updated_at on public.income;
create trigger set_income_updated_at before update on public.income
for each row execute function public.set_updated_at();

drop trigger if exists set_budget_categories_updated_at on public.budget_categories;
create trigger set_budget_categories_updated_at before update on public.budget_categories
for each row execute function public.set_updated_at();

drop trigger if exists set_planned_spending_updated_at on public.planned_spending;
create trigger set_planned_spending_updated_at before update on public.planned_spending
for each row execute function public.set_updated_at();

drop trigger if exists set_upcoming_payments_updated_at on public.upcoming_payments;
create trigger set_upcoming_payments_updated_at before update on public.upcoming_payments
for each row execute function public.set_updated_at();

drop trigger if exists set_debts_updated_at on public.debts;
create trigger set_debts_updated_at before update on public.debts
for each row execute function public.set_updated_at();

alter table public.transactions enable row level security;
alter table public.income enable row level security;
alter table public.budget_categories enable row level security;
alter table public.planned_spending enable row level security;
alter table public.upcoming_payments enable row level security;
alter table public.debts enable row level security;

create policy "Users can read own transactions" on public.transactions
for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on public.transactions
for insert with check (auth.uid() = user_id);
create policy "Users can update own transactions" on public.transactions
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can read own income" on public.income
for select using (auth.uid() = user_id);
create policy "Users can insert own income" on public.income
for insert with check (auth.uid() = user_id);
create policy "Users can update own income" on public.income
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can read own budget categories" on public.budget_categories
for select using (auth.uid() = user_id);
create policy "Users can insert own budget categories" on public.budget_categories
for insert with check (auth.uid() = user_id);
create policy "Users can update own budget categories" on public.budget_categories
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can read own planned spending" on public.planned_spending
for select using (auth.uid() = user_id);
create policy "Users can insert own planned spending" on public.planned_spending
for insert with check (auth.uid() = user_id);
create policy "Users can update own planned spending" on public.planned_spending
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can read own upcoming payments" on public.upcoming_payments
for select using (auth.uid() = user_id);
create policy "Users can insert own upcoming payments" on public.upcoming_payments
for insert with check (auth.uid() = user_id);
create policy "Users can update own upcoming payments" on public.upcoming_payments
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can read own debts" on public.debts
for select using (auth.uid() = user_id);
create policy "Users can insert own debts" on public.debts
for insert with check (auth.uid() = user_id);
create policy "Users can update own debts" on public.debts
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

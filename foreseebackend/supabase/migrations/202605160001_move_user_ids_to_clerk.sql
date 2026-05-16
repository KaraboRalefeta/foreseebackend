-- Destructive auth migration: the app now uses Clerk user IDs instead of Supabase Auth UUIDs.
-- Existing per-user data is cleared because Clerk users cannot be safely matched to old auth.users rows.

create or replace function public.clerk_user_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

truncate table
  public.transactions,
  public.income,
  public.budget_categories,
  public.planned_spending,
  public.upcoming_payments,
  public.debts,
  public.ai_pending_intents,
  public.ai_conversation_turns
restart identity;

drop policy if exists "Users can read own transactions" on public.transactions;
drop policy if exists "Users can insert own transactions" on public.transactions;
drop policy if exists "Users can update own transactions" on public.transactions;

drop policy if exists "Users can read own income" on public.income;
drop policy if exists "Users can insert own income" on public.income;
drop policy if exists "Users can update own income" on public.income;

drop policy if exists "Users can read own budget categories" on public.budget_categories;
drop policy if exists "Users can insert own budget categories" on public.budget_categories;
drop policy if exists "Users can update own budget categories" on public.budget_categories;

drop policy if exists "Users can read own planned spending" on public.planned_spending;
drop policy if exists "Users can insert own planned spending" on public.planned_spending;
drop policy if exists "Users can update own planned spending" on public.planned_spending;

drop policy if exists "Users can read own upcoming payments" on public.upcoming_payments;
drop policy if exists "Users can insert own upcoming payments" on public.upcoming_payments;
drop policy if exists "Users can update own upcoming payments" on public.upcoming_payments;

drop policy if exists "Users can read own debts" on public.debts;
drop policy if exists "Users can insert own debts" on public.debts;
drop policy if exists "Users can update own debts" on public.debts;

drop policy if exists "Users can read own pending intents" on public.ai_pending_intents;
drop policy if exists "Users can insert own pending intents" on public.ai_pending_intents;
drop policy if exists "Users can update own pending intents" on public.ai_pending_intents;
drop policy if exists "Users can delete own pending intents" on public.ai_pending_intents;

drop policy if exists "Users can read own conversation turns" on public.ai_conversation_turns;
drop policy if exists "Users can insert own conversation turns" on public.ai_conversation_turns;

alter table public.transactions drop constraint if exists transactions_user_id_fkey;
alter table public.income drop constraint if exists income_user_id_fkey;
alter table public.budget_categories drop constraint if exists budget_categories_user_id_fkey;
alter table public.planned_spending drop constraint if exists planned_spending_user_id_fkey;
alter table public.upcoming_payments drop constraint if exists upcoming_payments_user_id_fkey;
alter table public.debts drop constraint if exists debts_user_id_fkey;
alter table public.ai_pending_intents drop constraint if exists ai_pending_intents_user_id_fkey;
alter table public.ai_conversation_turns drop constraint if exists ai_conversation_turns_user_id_fkey;

alter table public.transactions alter column user_id type text using user_id::text;
alter table public.income alter column user_id type text using user_id::text;
alter table public.budget_categories alter column user_id type text using user_id::text;
alter table public.planned_spending alter column user_id type text using user_id::text;
alter table public.upcoming_payments alter column user_id type text using user_id::text;
alter table public.debts alter column user_id type text using user_id::text;
alter table public.ai_pending_intents alter column user_id type text using user_id::text;
alter table public.ai_conversation_turns alter column user_id type text using user_id::text;

create policy "Users can read own transactions" on public.transactions
for select using (public.clerk_user_id() = user_id);
create policy "Users can insert own transactions" on public.transactions
for insert with check (public.clerk_user_id() = user_id);
create policy "Users can update own transactions" on public.transactions
for update using (public.clerk_user_id() = user_id) with check (public.clerk_user_id() = user_id);

create policy "Users can read own income" on public.income
for select using (public.clerk_user_id() = user_id);
create policy "Users can insert own income" on public.income
for insert with check (public.clerk_user_id() = user_id);
create policy "Users can update own income" on public.income
for update using (public.clerk_user_id() = user_id) with check (public.clerk_user_id() = user_id);

create policy "Users can read own budget categories" on public.budget_categories
for select using (public.clerk_user_id() = user_id);
create policy "Users can insert own budget categories" on public.budget_categories
for insert with check (public.clerk_user_id() = user_id);
create policy "Users can update own budget categories" on public.budget_categories
for update using (public.clerk_user_id() = user_id) with check (public.clerk_user_id() = user_id);

create policy "Users can read own planned spending" on public.planned_spending
for select using (public.clerk_user_id() = user_id);
create policy "Users can insert own planned spending" on public.planned_spending
for insert with check (public.clerk_user_id() = user_id);
create policy "Users can update own planned spending" on public.planned_spending
for update using (public.clerk_user_id() = user_id) with check (public.clerk_user_id() = user_id);

create policy "Users can read own upcoming payments" on public.upcoming_payments
for select using (public.clerk_user_id() = user_id);
create policy "Users can insert own upcoming payments" on public.upcoming_payments
for insert with check (public.clerk_user_id() = user_id);
create policy "Users can update own upcoming payments" on public.upcoming_payments
for update using (public.clerk_user_id() = user_id) with check (public.clerk_user_id() = user_id);

create policy "Users can read own debts" on public.debts
for select using (public.clerk_user_id() = user_id);
create policy "Users can insert own debts" on public.debts
for insert with check (public.clerk_user_id() = user_id);
create policy "Users can update own debts" on public.debts
for update using (public.clerk_user_id() = user_id) with check (public.clerk_user_id() = user_id);

create policy "Users can read own pending intents" on public.ai_pending_intents
for select using (public.clerk_user_id() = user_id);
create policy "Users can insert own pending intents" on public.ai_pending_intents
for insert with check (public.clerk_user_id() = user_id);
create policy "Users can update own pending intents" on public.ai_pending_intents
for update using (public.clerk_user_id() = user_id) with check (public.clerk_user_id() = user_id);
create policy "Users can delete own pending intents" on public.ai_pending_intents
for delete using (public.clerk_user_id() = user_id);

create policy "Users can read own conversation turns" on public.ai_conversation_turns
for select using (public.clerk_user_id() = user_id);
create policy "Users can insert own conversation turns" on public.ai_conversation_turns
for insert with check (public.clerk_user_id() = user_id);

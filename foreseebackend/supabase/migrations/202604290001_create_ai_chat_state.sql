create table if not exists public.ai_pending_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  pending_intent jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, session_id)
);

create table if not exists public.ai_conversation_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists ai_pending_intents_user_session_idx
on public.ai_pending_intents (user_id, session_id);

create index if not exists ai_conversation_turns_user_session_created_idx
on public.ai_conversation_turns (user_id, session_id, created_at desc);

drop trigger if exists set_ai_pending_intents_updated_at on public.ai_pending_intents;
create trigger set_ai_pending_intents_updated_at before update on public.ai_pending_intents
for each row execute function public.set_updated_at();

alter table public.ai_pending_intents enable row level security;
alter table public.ai_conversation_turns enable row level security;

drop policy if exists "Users can read own pending intents" on public.ai_pending_intents;
create policy "Users can read own pending intents" on public.ai_pending_intents
for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own pending intents" on public.ai_pending_intents;
create policy "Users can insert own pending intents" on public.ai_pending_intents
for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own pending intents" on public.ai_pending_intents;
create policy "Users can update own pending intents" on public.ai_pending_intents
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own pending intents" on public.ai_pending_intents;
create policy "Users can delete own pending intents" on public.ai_pending_intents
for delete using (auth.uid() = user_id);

drop policy if exists "Users can read own conversation turns" on public.ai_conversation_turns;
create policy "Users can read own conversation turns" on public.ai_conversation_turns
for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own conversation turns" on public.ai_conversation_turns;
create policy "Users can insert own conversation turns" on public.ai_conversation_turns
for insert with check (auth.uid() = user_id);

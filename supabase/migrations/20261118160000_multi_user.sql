-- Multi-user (Ben, 18 Nov 2026). People Ben invites share his market data (candles, live bars,
-- scans, backtest and research results: already read-only to anyone signed in) and keep their
-- own charts, bots, limits and orders (already private by owner).
--
-- What's new: each person's bot runs on their own PC against their own Interactive Brokers
-- paper account and signs in with its own bot account, made for them by the `bot-key` function.
-- A bot account can read and write that one person's orders, requests and audit log, and read
-- their limits, bots and chart structures. Nothing else of theirs, and nobody else's. The
-- secret key (which bypasses all of this) stays on Ben's PC alone, for the data program.
--
-- The app itself still can't change an order: only a bot account can, and only the
-- person's own bot holds its key.

create table public.bot_accounts (
  bot_user   uuid primary key references auth.users (id) on delete cascade,
  owner      uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.bot_accounts is
  'Each person''s bot account (one each), made by the bot-key function. The bot signs in as it and acts for owner.';

alter table public.bot_accounts enable row level security;
create policy "own bot account" on public.bot_accounts for select to authenticated
  using (owner = (select auth.uid()) or bot_user = (select auth.uid()));
-- No insert, update or delete policy: only the bot-key function (server side) writes.

-- Whose bot is signed in: the person it acts for, or nobody.
create function public.bot_owner() returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$ select owner from public.bot_accounts where bot_user = (select auth.uid()) $$;

revoke all on function public.bot_owner() from public, anon;
grant execute on function public.bot_owner() to authenticated;

-- What a bot account may do, for its person only.
create policy "bot: read limits" on public.safety_limits for select to authenticated using (owner = (select public.bot_owner()));
create policy "bot: read bots" on public.bot_strategies for select to authenticated using (owner = (select public.bot_owner()));
create policy "bot: read structures" on public.option_positions for select to authenticated using (owner = (select public.bot_owner()));
create policy "bot: read requests" on public.bot_requests for select to authenticated using (owner = (select public.bot_owner()));
create policy "bot: answer requests" on public.bot_requests for update to authenticated
  using (owner = (select public.bot_owner())) with check (owner = (select public.bot_owner()));
create policy "bot: read orders" on public.paper_orders for select to authenticated using (owner = (select public.bot_owner()));
create policy "bot: add orders" on public.paper_orders for insert to authenticated with check (owner = (select public.bot_owner()));
create policy "bot: change orders" on public.paper_orders for update to authenticated
  using (owner = (select public.bot_owner())) with check (owner = (select public.bot_owner()));
create policy "bot: read audit" on public.audit_log for select to authenticated using (user_id = (select public.bot_owner()));
create policy "bot: add audit" on public.audit_log for insert to authenticated with check (user_id = (select public.bot_owner()));

-- Claude in the app costs Ben's Anthropic account: only the people listed here may use it
-- (Ben, from the start). The claude function checks it; the app hides the button otherwise.
create table public.claude_access (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.claude_access enable row level security;
create policy "own access" on public.claude_access for select to authenticated using (user_id = (select auth.uid()));

-- Everyone signed up before people were invited is Ben.
insert into public.claude_access (user_id) select id from auth.users;

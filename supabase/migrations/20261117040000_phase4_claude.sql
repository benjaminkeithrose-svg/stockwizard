-- Phase 4: Claude in the app. An append-only audit log of every action Claude
-- (and later the bot and Ben) takes, and a daily count of Claude requests for
-- the cap Ben set (100 a day, 17 Nov 2026).

create table public.audit_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  actor    text not null check (actor in ('claude', 'ben', 'server', 'bot')),
  user_id  uuid references auth.users (id) on delete set null,
  action   text not null,              -- e.g. create_strategy, run_backtest
  detail   jsonb not null default '{}'::jsonb
);

create index audit_log_at on public.audit_log (at desc);

-- Append-only: no row is ever changed or removed, whoever asks (the secret key included).
create function public.audit_log_is_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'The audit log is append-only: rows cannot be changed or deleted';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_is_append_only();

alter table public.audit_log enable row level security;
create policy "own entries" on public.audit_log for select to authenticated using (user_id = (select auth.uid()));

create table public.claude_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  requests integer not null default 0,
  primary key (user_id, day)
);

alter table public.claude_usage enable row level security;
create policy "own usage" on public.claude_usage for select to authenticated using (user_id = (select auth.uid()));

-- Count one request against today's cap; false when the cap is reached. Server only.
create function public.claude_take(p_user uuid, p_limit integer) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare used integer;
begin
  insert into public.claude_usage (user_id, day, requests) values (p_user, (now() at time zone 'Australia/Sydney')::date, 1)
  on conflict (user_id, day) do update set requests = public.claude_usage.requests + 1
  returning requests into used;
  if used > p_limit then
    update public.claude_usage set requests = requests - 1 where user_id = p_user and day = (now() at time zone 'Australia/Sydney')::date;
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.claude_take(uuid, integer) from public, anon, authenticated;

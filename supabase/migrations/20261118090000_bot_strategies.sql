-- Strategies the bot runs by itself (Ben, 18 Nov 2026). Each is a 0DTE
-- research configuration (backend/stockwizard/zerodte/strategy.Config). When
-- one is switched on, at its entry time each trading day the bot checks the
-- setup, prices the trade, puts it through every safety rail, and leaves it
-- waiting for Ben's approval (or sends it, in automatic mode). The bot also
-- manages its exits and settles it at the close.
--
-- Ben adds, switches on and off, and removes his own strategies; every change
-- is audited. Claude has no tool for this table.

create table public.bot_strategies (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label       text not null,
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  enabled     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index bot_strategies_owner on public.bot_strategies (owner);

comment on table public.bot_strategies is
  'Strategies the paper bot proposes by itself at their entry time (rails and approval as usual). Changes audited by trigger.';

create trigger bot_strategies_touch before update on public.bot_strategies
  for each row execute function public.touch_updated_at();

create function public.audit_bot_strategies() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  r public.bot_strategies := case when tg_op = 'DELETE' then old else new end;
begin
  insert into public.audit_log (actor, user_id, action, detail)
  values (
    case when auth.uid() is null then 'server' else 'ben' end, r.owner,
    case
      when tg_op = 'INSERT' then 'strategy_added'
      when tg_op = 'DELETE' then 'strategy_removed'
      when old.enabled is distinct from new.enabled then case when new.enabled then 'strategy_on' else 'strategy_off' end
      else 'strategy_changed'
    end,
    jsonb_build_object('strategy', r.id, 'label', r.label, 'config', r.config, 'enabled', r.enabled)
  );
  return r;
end;
$$;
revoke execute on function public.audit_bot_strategies() from public, anon, authenticated;

create trigger bot_strategies_audit after insert or update or delete on public.bot_strategies
  for each row execute function public.audit_bot_strategies();

alter table public.bot_strategies enable row level security;
create policy "own strategies" on public.bot_strategies
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- Which strategy proposed an order (null for orders from the chart or practice).
alter table public.paper_orders add column strategy_id uuid references public.bot_strategies (id) on delete set null;

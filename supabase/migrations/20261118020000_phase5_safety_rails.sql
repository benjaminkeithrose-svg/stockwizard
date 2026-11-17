-- Phase 5's safety rails, as stored (SPEC.md, Broker adapter and safety rails).
-- The rails themselves run in the bot (backend/stockwizard/rails.py, bot.py);
-- these tables hold the limits Ben sets and the orders the bot proposes.
--
-- safety_limits: one row per person. The daily loss limit starts empty, and
--   while it is empty the bot refuses every order. Every change is written to
--   the audit log by a trigger, whoever makes it. There is no live-trading
--   setting anywhere: live stays disabled and can't be enabled from the app.
-- paper_orders: written only by the bot (server side). Ben approves or
--   rejects a proposal through decide_order(), which records it; the bot
--   checks every rail again before sending an approved order.
-- kill_switch(): one action that blocks new orders and drops every proposal
--   still waiting; the bot cancels working orders at the broker when it sees it.

create table public.safety_limits (
  owner                 uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  max_loss_per_trade    numeric not null default 50 check (max_loss_per_trade > 0),
  max_loss_per_day      numeric check (max_loss_per_day > 0),            -- empty: every order refused
  max_open_positions    integer not null default 1 check (max_open_positions > 0),
  max_capital_at_risk   numeric not null default 100 check (max_capital_at_risk > 0),
  max_data_age_seconds  integer not null default 120 check (max_data_age_seconds between 5 and 3600),
  approval_mode         text not null default 'approval' check (approval_mode in ('approval', 'automatic')),
  kill_switch           boolean not null default false,
  updated_at            timestamptz not null default now()
);

comment on table public.safety_limits is
  'The limits the bot checks before every order. Changes are audited by trigger. There is deliberately no live-trading setting.';

create trigger safety_limits_touch before update on public.safety_limits
  for each row execute function public.touch_updated_at();

-- Every change to the limits goes to the audit log, old and new values side by side.
create function public.audit_safety_limits() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.audit_log (actor, user_id, action, detail)
  values (
    case when auth.uid() is null then 'server' else 'ben' end,
    new.owner,
    case when tg_op = 'INSERT' then 'limits_set' else 'limits_changed' end,
    jsonb_build_object(
      'old', case when tg_op = 'UPDATE' then to_jsonb(old) - 'updated_at' - 'owner' else null end,
      'new', to_jsonb(new) - 'updated_at' - 'owner'
    )
  );
  return new;
end;
$$;
revoke execute on function public.audit_safety_limits() from public, anon, authenticated;

create trigger safety_limits_audit after insert or update on public.safety_limits
  for each row execute function public.audit_safety_limits();

alter table public.safety_limits enable row level security;

create policy "own limits" on public.safety_limits
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

create table public.paper_orders (
  id           bigint generated always as identity primary key,
  owner        uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  symbol       text not null,
  structure    text not null,
  expiry       date not null,
  legs         jsonb not null check (jsonb_typeof(legs) = 'array'),
  quantity     integer not null check (quantity > 0),
  limit_price  numeric not null check (limit_price > 0),
  price_kind   text not null check (price_kind in ('credit', 'debit')),
  max_loss     numeric,
  status       text not null default 'proposed' check (status in
                 ('proposed', 'refused', 'approved', 'rejected', 'sent', 'filled', 'cancelled', 'closed', 'failed')),
  refusals     jsonb not null default '[]'::jsonb,
  reason       text,                     -- why the bot proposed it, in plain words
  broker_id    text,
  fill_price   numeric,
  pnl          numeric,
  decided_at   timestamptz,
  updated_at   timestamptz not null default now()
);

create index paper_orders_owner on public.paper_orders (owner, created_at desc);

comment on table public.paper_orders is
  'Orders the bot proposed, Ben''s decision, and what the broker did. Paper only. Written by the bot; Ben decides through decide_order().';

create trigger paper_orders_touch before update on public.paper_orders
  for each row execute function public.touch_updated_at();

alter table public.paper_orders enable row level security;
create policy "own orders" on public.paper_orders for select to authenticated using (owner = (select auth.uid()));
-- No insert, update or delete policy: only the bot (server side) writes.

-- Ben approves or rejects a proposal. Approval only marks it; the bot checks every rail again before sending.
create function public.decide_order(order_id bigint, approve boolean) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o public.paper_orders;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into o from public.paper_orders where id = order_id and owner = me for update;
  if not found then raise exception 'No such order'; end if;
  if o.status <> 'proposed' then raise exception 'Order % is %, not waiting for approval', order_id, o.status; end if;
  if approve and coalesce((select kill_switch from public.safety_limits where owner = me), false) then
    raise exception 'The kill switch is on: nothing can be approved';
  end if;
  update public.paper_orders
    set status = case when approve then 'approved' else 'rejected' end, decided_at = now()
    where id = order_id;
  insert into public.audit_log (actor, user_id, action, detail)
    values ('ben', me, case when approve then 'order_approved' else 'order_rejected' end, jsonb_build_object('order', order_id));
  return case when approve then 'approved' else 'rejected' end;
end;
$$;
revoke execute on function public.decide_order(bigint, boolean) from public, anon;
grant execute on function public.decide_order(bigint, boolean) to authenticated;

-- The kill switch: block new orders, drop every proposal waiting or approved but not yet sent. Recorded.
create function public.kill_switch() returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  me uuid := auth.uid();
  dropped integer;
begin
  if me is null then raise exception 'Sign in first'; end if;
  insert into public.safety_limits (owner, kill_switch) values (me, true)
    on conflict (owner) do update set kill_switch = true;
  update public.paper_orders set status = 'cancelled' where owner = me and status in ('proposed', 'approved');
  get diagnostics dropped = row_count;
  insert into public.audit_log (actor, user_id, action, detail)
    values ('ben', me, 'kill_switch', jsonb_build_object('proposals_dropped', dropped));
  return dropped;
end;
$$;
revoke execute on function public.kill_switch() from public, anon;
grant execute on function public.kill_switch() to authenticated;

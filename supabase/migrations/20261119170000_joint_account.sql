-- A joint account (Ben, 19 Nov 2026): two people working one trading account, each with full say.
--
-- The account belongs to the person whose PC trades it (one TWS login, one bot). Their partner, on
-- their own install, sees and does everything on it: orders, approvals, closes, the kill switch, the
-- limits and the automated strategies. The partner's own trading is replaced by the shared account
-- while they're a partner (their old rows stay, out of sight). Chart tabs, pages, favourites and
-- structures stay each person's own. trading_owner() is whose trading account a signed-in person
-- works: their partner's if they're a partner, otherwise their own; every trading rule uses it.

create table public.trading_partners (
  partner        uuid primary key references auth.users (id) on delete cascade,   -- one shared account each
  owner          uuid not null references auth.users (id) on delete cascade,
  partner_email  text not null,
  owner_email    text not null,
  added_at       timestamptz not null default now(),
  constraint not_yourself check (partner <> owner)
);
create index trading_partners_owner on public.trading_partners (owner);

comment on table public.trading_partners is
  'Joint accounts: the partner works the owner''s trading account (orders, limits, strategies) with full say. Added and removed through add_partner() and remove_partner(); both are audited.';

alter table public.trading_partners enable row level security;
create policy "see your joint account" on public.trading_partners for select to authenticated
  using (owner = (select auth.uid()) or partner = (select auth.uid()));
-- The bot reads it to know whose structures it may order, and that a partner's PC doesn't trade.
create policy "bot: see joint account" on public.trading_partners for select to authenticated
  using (owner = (select public.bot_owner()) or partner = (select public.bot_owner()));
-- No insert, update or delete policy: only through the functions below.

create function public.trading_owner() returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$ select coalesce((select owner from public.trading_partners where partner = (select auth.uid())), (select auth.uid())) $$;
revoke execute on function public.trading_owner() from public, anon;
grant execute on function public.trading_owner() to authenticated;

-- The account's owner adds a partner by their sign-in email: someone already invited to Stock Wizard.
create function public.add_partner(email text) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_email text;
  them uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.trading_partners where partner = me) then
    raise exception 'You''re a partner on someone else''s account, so you can''t share one of your own';
  end if;
  if exists (select 1 from public.trading_partners where owner = me) then
    raise exception 'Your account is already shared; remove that partner first';
  end if;
  select id into them from auth.users where lower(auth.users.email) = lower(trim(add_partner.email));
  if them is null then raise exception 'No one has signed in to Stock Wizard with that email; invite them first'; end if;
  if them = me then raise exception 'That''s your own email'; end if;
  if exists (select 1 from public.trading_partners where owner = them or partner = them) then
    raise exception 'They''re already on a joint account';
  end if;
  select auth.users.email into my_email from auth.users where id = me;
  insert into public.trading_partners (partner, owner, partner_email, owner_email) values (them, me, lower(trim(add_partner.email)), my_email);
  insert into public.audit_log (actor, user_id, action, detail)
    values ('ben', me, 'partner_added', jsonb_build_object('partner', them, 'email', lower(trim(add_partner.email))));
  return 'added';
end;
$$;
revoke execute on function public.add_partner(text) from public, anon;
grant execute on function public.add_partner(text) to authenticated;

-- Either person ends it: the owner removes the partner, or the partner leaves.
create function public.remove_partner() returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  me uuid := auth.uid();
  row_ public.trading_partners;
begin
  if me is null then raise exception 'Sign in first'; end if;
  delete from public.trading_partners where owner = me or partner = me returning * into row_;
  if row_.partner is null then raise exception 'There''s no joint account to end'; end if;
  insert into public.audit_log (actor, user_id, action, detail)
    values ('ben', row_.owner, 'partner_removed', jsonb_build_object('partner', row_.partner, 'email', row_.partner_email, 'by', me));
  return 'removed';
end;
$$;
revoke execute on function public.remove_partner() from public, anon;
grant execute on function public.remove_partner() to authenticated;

-- New trading rows belong to the account worked, so a partner's limits, strategies and requests land on it.
alter table public.safety_limits alter column owner set default public.trading_owner();
alter table public.bot_strategies alter column owner set default public.trading_owner();
alter table public.bot_requests alter column owner set default public.trading_owner();

-- The trading rules: the account worked, not just your own rows.
drop policy "own limits" on public.safety_limits;
create policy "account limits" on public.safety_limits for all to authenticated
  using (owner = (select public.trading_owner())) with check (owner = (select public.trading_owner()));

drop policy "own strategies" on public.bot_strategies;
create policy "account strategies" on public.bot_strategies for all to authenticated
  using (owner = (select public.trading_owner())) with check (owner = (select public.trading_owner()));

drop policy "own orders" on public.paper_orders;
create policy "account orders" on public.paper_orders for select to authenticated using (owner = (select public.trading_owner()));

drop policy "own requests: read" on public.bot_requests;
create policy "account requests: read" on public.bot_requests for select to authenticated using (owner = (select public.trading_owner()));
drop policy "own requests: add" on public.bot_requests;
create policy "account requests: add" on public.bot_requests for insert to authenticated
  with check (owner = (select public.trading_owner()) and status = 'waiting' and result is null and done_at is null);

drop policy "own PC" on public.pc_status;
create policy "account PC" on public.pc_status for select to authenticated
  using (owner = (select public.trading_owner()) or owner = (select public.bot_owner()));

drop policy "own entries" on public.audit_log;
create policy "own and account entries" on public.audit_log for select to authenticated
  using (user_id = (select auth.uid()) or user_id = (select public.trading_owner()));

-- The bot may read a partner's structure when the partner asks it to order one.
create policy "bot: read partner's structures" on public.option_positions for select to authenticated
  using (owner in (select partner from public.trading_partners where owner = (select public.bot_owner())));

-- Approving and the kill switch act on the account worked, and say who did it.
create or replace function public.decide_order(order_id bigint, approve boolean) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  me uuid := auth.uid();
  acct uuid := public.trading_owner();
  o public.paper_orders;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into o from public.paper_orders where id = order_id and owner = acct for update;
  if not found then raise exception 'No such order'; end if;
  if o.status <> 'proposed' then raise exception 'Order % is %, not waiting for approval', order_id, o.status; end if;
  if approve and coalesce((select kill_switch from public.safety_limits where owner = acct), false) then
    raise exception 'The kill switch is on: nothing can be approved';
  end if;
  update public.paper_orders
    set status = case when approve then 'approved' else 'rejected' end, decided_at = now()
    where id = order_id;
  insert into public.audit_log (actor, user_id, action, detail)
    values ('ben', acct, case when approve then 'order_approved' else 'order_rejected' end, jsonb_build_object('order', order_id, 'by', me));
  return case when approve then 'approved' else 'rejected' end;
end;
$$;

create or replace function public.kill_switch() returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  me uuid := auth.uid();
  acct uuid := public.trading_owner();
  dropped integer;
begin
  if me is null then raise exception 'Sign in first'; end if;
  insert into public.safety_limits (owner, kill_switch) values (acct, true)
    on conflict (owner) do update set kill_switch = true;
  update public.paper_orders set status = 'cancelled' where owner = acct and status in ('proposed', 'approved');
  get diagnostics dropped = row_count;
  insert into public.audit_log (actor, user_id, action, detail)
    values ('ben', acct, 'kill_switch', jsonb_build_object('proposals_dropped', dropped, 'by', me));
  return dropped;
end;
$$;

-- Ben's requests to the bot from the app (18 Nov 2026): order a structure
-- placed on the chart (paper), or close a filled paper position.
--
-- A request is not an order. The bot prices an open request and puts it
-- through every safety rail; it then waits for Ben's approval like any other
-- proposal. A close request closes a filled position at the current price
-- (closing only reduces risk). The app may only add requests, never change
-- them; the bot (server side) marks them done. Every request is audited.

create table public.bot_requests (
  id            bigint generated always as identity primary key,
  owner         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('open', 'close')),
  position_id   uuid references public.option_positions (id) on delete set null,  -- open: the structure on the chart
  order_id      bigint references public.paper_orders (id) on delete set null,    -- close: the filled paper order
  quantity      integer not null default 1 check (quantity between 1 and 10),
  status        text not null default 'waiting' check (status in ('waiting', 'done', 'failed')),
  result        text,                                                              -- what the bot did, in plain words
  done_at       timestamptz,
  constraint open_names_a_position check (kind <> 'open' or position_id is not null),
  constraint close_names_an_order check (kind <> 'close' or order_id is not null)
);

create index bot_requests_waiting on public.bot_requests (owner, status, created_at);

comment on table public.bot_requests is
  'Ben''s requests to the bot from the app: order a chart structure (paper; still needs his approval after the rails) or close a paper position. Not orders.';

alter table public.bot_requests enable row level security;
create policy "own requests: read" on public.bot_requests for select to authenticated using (owner = (select auth.uid()));
create policy "own requests: add" on public.bot_requests for insert to authenticated
  with check (owner = (select auth.uid()) and status = 'waiting' and result is null and done_at is null);
-- No update or delete for the app: only the bot marks a request done.

create function public.audit_bot_request() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.audit_log (actor, user_id, action, detail)
  values (
    case when auth.uid() is null then 'server' else 'ben' end, new.owner,
    case when new.kind = 'open' then 'order_requested' else 'close_requested' end,
    jsonb_build_object('request', new.id, 'position', new.position_id, 'order', new.order_id, 'quantity', new.quantity)
  );
  return new;
end;
$$;
revoke execute on function public.audit_bot_request() from public, anon, authenticated;

create trigger bot_requests_audit after insert on public.bot_requests
  for each row execute function public.audit_bot_request();

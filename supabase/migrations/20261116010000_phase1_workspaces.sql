-- Phase 1: saved workspace tabs, so a chart set up on one device opens the
-- same on another.

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),  -- made on the device, so a new tab needs no round trip
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  position    integer not null default 0,                   -- tab order
  symbol      text not null,
  timeframe   text not null check (timeframe in ('5m', '15m', '30m', '1h', '1d')),
  indicators  jsonb not null default '[]'::jsonb,           -- [{id, name, params, code_version}]
  drawings    jsonb not null default '[]'::jsonb,           -- [{id, kind: level|trendline, points}]
  layout      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint indicators_is_list check (jsonb_typeof(indicators) = 'array'),
  constraint drawings_is_list check (jsonb_typeof(drawings) = 'array')
);

create index workspaces_owner on public.workspaces (owner, position);

comment on table public.workspaces is 'Saved chart tabs: symbol, timeframe, indicators, drawings and layout.';

-- Every change stamps updated_at, whatever the device's clock says.
create function public.touch_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workspaces_touch before update on public.workspaces
  for each row execute function public.touch_updated_at();

alter table public.workspaces enable row level security;

create policy "own workspaces" on public.workspaces
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- Indicator favourites, and calls and puts placed on the chart (Ben, 17 Nov 2026).
--
-- user_settings: one row per person; favourites are the chips along the top of
-- every chart for one-tap adding.
-- option_positions: option structures drawn on a symbol's charts. Planned or
-- marked bought by hand; nothing here is an order and nothing is sent to a
-- broker (phase 5's safety rails decide that, later).

create table public.user_settings (
  owner       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  favourites  jsonb not null default '[]'::jsonb,   -- [{kind: indicator, name, params} | {kind: structure, structure}]
  updated_at  timestamptz not null default now(),
  constraint favourites_is_list check (jsonb_typeof(favourites) = 'array'),
  constraint at_most_twenty_favourites check (jsonb_array_length(favourites) <= 20)
);

create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

alter table public.user_settings enable row level security;

create policy "own settings" on public.user_settings
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

create table public.option_positions (
  id          uuid primary key default gen_random_uuid(),  -- made on the device
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol      text not null,
  structure   text not null check (structure in
                ('iron_condor', 'iron_fly', 'bull_call', 'bear_put', 'bull_put', 'bear_call', 'call', 'put')),
  expiry      date not null,
  legs        jsonb not null,                              -- [{right: C|P, side: buy|sell, strike, qty}]
  status      text not null default 'planned' check (status in ('planned', 'bought', 'closed')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint legs_is_list check (jsonb_typeof(legs) = 'array'),
  constraint one_to_four_legs check (jsonb_array_length(legs) between 1 and 4)
);

create index option_positions_owner on public.option_positions (owner, symbol);

comment on table public.option_positions is
  'Option structures drawn on the chart. Planned (purple) or marked bought (green) by hand. Not orders: nothing here is sent to a broker.';

create trigger option_positions_touch before update on public.option_positions
  for each row execute function public.touch_updated_at();

alter table public.option_positions enable row level security;

create policy "own option positions" on public.option_positions
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

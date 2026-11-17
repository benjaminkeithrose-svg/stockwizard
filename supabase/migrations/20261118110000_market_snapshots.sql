-- The latest market snapshot, for the app's Today screen (Ben, 18 Nov 2026).
-- The app's candles only update after the US close, so during the session the
-- bot writes what it sees each cycle: price, VIX, VIX1D, the expected move to
-- the close, the opening range, VWAP and the direction rule's reading. One row
-- per symbol, overwritten each time. Server writes; signed-in read.

create table public.market_snapshots (
  symbol         text primary key,
  taken_at       timestamptz not null,
  session_date   date not null,
  price          numeric not null,
  vix            numeric,
  vix1d          numeric,
  expected_move  numeric,          -- one standard deviation to today's close, in price
  or_high        numeric,
  or_low         numeric,
  vwap           numeric,
  direction      text check (direction in ('bullish', 'bearish', 'neutral')),
  source         text not null     -- pretend (free 5-minute candles) or ibkr
);

comment on table public.market_snapshots is 'What the bot sees each cycle during the US session, for the Today screen. Server writes; signed-in read.';

alter table public.market_snapshots enable row level security;
create policy "signed-in read" on public.market_snapshots for select to authenticated using (true);

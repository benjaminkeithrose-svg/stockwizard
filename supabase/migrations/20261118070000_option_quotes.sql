-- Real option quotes recorded by the bot from Interactive Brokers (18 Nov
-- 2026), building our own price history so backtests can move from modelled
-- prices to real ones. A snapshot every 30 minutes through the US session:
-- SPY's next 4 expiries, strikes within 2% of the price, calls and puts.
-- About 170 rows a snapshot, 2,200 a day. Written server-side; signed-in read.

create table public.option_quotes (
  id          bigint generated always as identity primary key,
  taken_at    timestamptz not null,
  symbol      text not null,
  expiry      date not null,
  strike      numeric not null,
  "right"     text not null check ("right" in ('C', 'P')),
  bid         numeric,
  ask         numeric,
  last        numeric,
  iv          numeric,               -- IBKR's implied volatility, when it gives one
  underlying  numeric not null,      -- the symbol's price at the snapshot
  source      text not null default 'ibkr',
  unique (symbol, taken_at, expiry, strike, "right")
);

create index option_quotes_lookup on public.option_quotes (symbol, expiry, taken_at);

comment on table public.option_quotes is
  'Option bid/ask snapshots recorded by the bot from Interactive Brokers: our own price history for backtests. Server writes; signed-in read.';

alter table public.option_quotes enable row level security;
create policy "signed-in read" on public.option_quotes for select to authenticated using (true);

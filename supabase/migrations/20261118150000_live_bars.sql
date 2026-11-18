-- Live bars (Ben, 18 Nov 2026): during the US session the data program on Ben's PC
-- streams prices from Interactive Brokers and writes today's 1-minute bars here every
-- few seconds; the open chart reads them to keep its last candle moving. Today only:
-- the data program clears earlier days. Not candles: a bar here may still be forming.

create table public.live_bars (
  symbol     text not null references public.symbols (symbol) on update cascade,
  ts         timestamptz not null,                 -- the minute's open, UTC
  open       double precision not null check (open > 0),
  high       double precision not null,
  low        double precision not null check (low > 0),
  close      double precision not null check (close > 0),
  volume     double precision not null default 0 check (volume >= 0),
  delayed    boolean not null default false,       -- IBKR sent delayed prices (about 15 minutes behind)
  updated_at timestamptz not null default now(),
  primary key (symbol, ts),
  constraint high_is_highest check (high >= greatest(open, close, low)),
  constraint low_is_lowest check (low <= least(open, close, high))
);

comment on table public.live_bars is
  'Today''s 1-minute bars from the data program, written every few seconds in US hours; the last one may still be forming.';

alter table public.live_bars enable row level security;
create policy "signed-in read" on public.live_bars for select to authenticated using (true);
-- No insert, update or delete policy: only the data program (server side) writes.

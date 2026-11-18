# Stock Wizard: the guide

What Stock Wizard does and how to use it, in plain English. The app's own
Help (Menu, Help) has the short version of each screen; this page explains
the thinking behind it. Refreshed 19 November 2026: refreshed when Ben asks.

The app: https://benjaminkeithrose-svg.github.io/stockwizard/

## What it is

Five parts that build on each other:

1. **Charts.** Candles, indicators, drawings and option structures laid on
   the price. They work the same on the phone and the PC.
2. **The scanner.** After every US trading day's close, six rules are run
   over your symbols: squeeze on, squeeze fired, breakout, trend break,
   drawdown and RSI divergence.
3. **Backtests.** How a rule or an option structure would have done over
   about 20 years, judged honestly (see "How a backtest is judged").
4. **The pattern lab and the 0DTE research.** Searches across hundreds of
   combinations, with a check that throws out what looks good only by luck.
5. **The bot.** It trades on **paper** at Interactive Brokers, only through
   the safety rails, and only bots whose settings were backtested. It runs
   in the Stock Wizard program on your Windows PC, next to TWS.

Claude sits on top of all of it. Ask in plain words and it runs tests,
explains results or sets up a chart. It cannot place orders or change limits.

## A normal week

1. **Each morning (Sydney):** open **Today**. You'll see whether the US
   market is open, the market numbers, what each bot did overnight, and the
   day's result against your loss limit.
2. **When your phone buzzes:** the ntfy app tells you an order is waiting, a
   trade filled, closed or stopped, or the daily limit was hit. Open Menu →
   Safety and orders to act on it.
3. **When you have an idea:** set it up on a chart, open its analysis, find
   the nearest backtest, and if the held-back years support it, tap **Make a
   bot**.

## Market data

Candles come from Interactive Brokers, through the Stock Wizard program on
Ben's PC. It keeps every candle in an archive on that PC (daily back to 1990
for some symbols) and puts the recent part in Supabase for the app: daily for
5 years, hourly for 2 years, 5-minute for 60 days. In US hours the charts add
today's bars every 5 seconds, marked **Live** or **Delayed** (about 15 minutes
late without a market data subscription). While Ben's PC or TWS is off,
nothing updates; the next start fills the gap.

## Charts

- **Tabs** hold a symbol and timeframe each; **Chart pages** show up to ten
  at once as cards.
- **Indicators** (the toolbar button shows how many are on) holds the
  indicators on this chart, your favourites for one-tap adding, and the
  full list. The indicator maths is identical in the app and in the
  backtests: a test compares them number by number.
- **Options** places a structure one daily range from the price with $5
  wings. Drag the lines to adjust it. Starred structures sit above the
  chart on every chart; the symbol button keeps one to that symbol only.
- **Analysis** (tap a structure's chip) shows profit or loss at every price,
  at expiry and at a date you choose. It also shows time decay, the Greeks,
  the chance of profit and the expected move, and can compare up to three
  structures. Prices are theoretical (Black-Scholes, with the VIX for SPY)
  until Interactive Brokers supplies real ones.
- **Bot trades** show in teal: open positions as lines, an arrow where a
  trade opened and a dot with its result where it closed.

## How a backtest is judged

The aim is to know what to expect, not to find something that looks good.

- **No look-ahead.** Every signal uses only what was known at the time.
  Each rule passes a "truncation test": cut the data off at any day and
  every earlier result stays the same.
- **Twenty years of history.** Backtests run on Ben's PC, on the archive:
  IBKR's candles, with Yahoo's older ones only for the years IBKR doesn't
  reach (the VIX before October 2005). Those runs keep the free-data
  warning. A few misplaced-decimal prices in IBKR's old candles are
  repaired as they're read.
- **Build years and held-back years.** Rules are made on 2006 to 2021. The
  last five years are held back, and **only the held-back column stands
  for what to expect**. Held-back years can be used once. Change a rule
  after seeing them and they're marked "burned".
- **Costs are in.** $0.65 a contract a leg, plus 5 cents a leg slippage each
  way for options. Fills are at the next open for stocks.
- **Modelled option prices.** There is no 20-year history of option quotes
  here yet, so options are priced with Black-Scholes and the VIX. Real
  wings usually cost more. The bot records real quotes from Interactive
  Brokers every 30 minutes, so tests can move to real prices over time.
- **The false-discovery check** (Benjamini-Hochberg) applies when hundreds
  of combinations are tried, as in the pattern lab and the 0DTE research.
  It keeps only results too strong to be luck. Survivors are then tested
  once on data they weren't chosen on.
- **The $5,000 kitty.** Each backtest shows what $5,000 would have become,
  trade by trade, risking 2% of the balance on each. A trade that can't fit
  in 2% at one contract is skipped and counted.

What the results say so far (all modelled, none of it evidence yet):

- Selling premium (credit spreads and iron condors) wins often and loses
  big now and then. Stops at twice the credit helped in the held-back
  years.
- Bullish structures did well and bearish ones badly over a rising market.
- On a month-long trade, closing at 21 days left loses: the trade is closed
  after about 6 days and pays its costs twice.
- Same-day (0DTE) results depend heavily on the model. Published studies
  find no reliable edge after costs. Real quotes are needed before trusting
  any of it.

## Bots

A bot is a rule the bot program runs by itself every trading day.

- **Made from a backtest.** Tap **Make a bot** on an option backtest page or
  a 0DTE survivor. It copies the tested settings exactly: structure,
  expiry, strike placement, wings, management, VIX filter and signal.
- **Tested or untested.** Only a bot whose settings still equal the tested
  ones can be switched on. Change one and the bot is switched off and marked
  untested; **Put them back** restores the tested settings. A bot set up by
  hand is untested.
- **What can't be a bot yet:** stock strategies and pattern lab results
  (stock signals; the bot trades options), the same-day methods tested on
  hourly candles, and call or put condors.
- **Each day.** In the 15 minutes after its entry time (New York) the bot
  checks the setup. That covers the VIX range, the signal at the previous
  close, and direction for directional bots. It then picks the strikes and
  proposes the trade at the price it can count on getting.
- **While a trade is open,** the bot checks its exits every cycle: profit
  target, stop, days left and time of day. Anything still open settles at
  its expiry's close. A multi-day bot holds one position at a time.
- **Paper results against the backtest.** Each bot's card shows its closed
  paper trades, share won and average a trade beside what the backtest
  expected. That comparison is how you tell whether a bot is behaving like
  its test.

Two known differences from the option backtests:

- A bot enters at 10:00 New York; the test enters at the open.
- A bot checks its exits every cycle; the test checks them at each daily
  close.

## The safety rails

Every order passes every rail twice: when it's proposed, and again with a
fresh price when it's approved.

- **Defined risk only.** No naked options; the most it can lose is known.
- **The most a trade may lose, and the most a day may lose.** While the
  daily limit is empty, every order is refused.
- **Positions open at once, and capital at risk.**
- **Fresh prices.** Prices may not be older than your limit.
- **Limit orders only.**
- **The kill switch** (Safety and orders) stops everything at once.
- **Paper only.** Live trading can't be enabled from the app. The bot
  refuses Interactive Brokers' live ports and any account that isn't a
  paper account (DU…).

**Approve** mode waits for you on every order. **Automatic** mode (paper
only, your choice for overnight) sends an order as soon as every rail
passes. Either way, every step is written to the audit log, which can't be
changed.

## What it costs and where it lives

How everything runs, what to do when something goes wrong, and the
accounts involved: [OPERATIONS.md](OPERATIONS.md).

Setting up Stock Wizard on a PC: [SETUP-BOT.md](SETUP-BOT.md). What Ben's PC
does as well (market data, the archive, backtests): [PC-BOT.md](PC-BOT.md).

The 0DTE research report: [research/0DTE-RESEARCH.md](research/0DTE-RESEARCH.md).

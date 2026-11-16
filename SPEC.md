# Trading Workspace: Handoff Spec for Claude Code

Exported from the Claude doc "Trading Workspace: Handoff Spec for Claude Code" on 16 Nov 2026. Owner: Ben.

## Purpose and ground rules

Build a technical-analysis workspace with a scanner, a bar-by-bar backtester and, last of all, a paper-trading bot on Interactive Brokers, all backed by Supabase. This is the brief for Claude Code; the reasoning behind it is in the companion doc "Technical Trading Workspace: Proposal".

- **Honesty first.** The backtester's win rate must be a fair forecast of live results, so no look-ahead of any kind.
- **Safety before features.** No order logic exists until the safety rails in this spec do, and live trading stays disabled until Ben passes the gates.
- **Simple on the surface.** Ben wants complexity hidden but results trusted: every number on screen must trace back to a saved, reproducible run.
- **Look and feel is out of scope.** Do not design or restyle the interface. Ben has existing repositories that define the visual conventions and will point you to them. Build functionality and data first, and follow those conventions when UI is needed.

## Decisions and inputs needed

These are settled, so do not reopen them:

- Broker: Interactive Brokers, through its Python API.
- Database: Supabase (Postgres).
- App: an installable web app, with Claude built in. No native app.
- Universe: US stocks and ETFs, plus an ASX watchlist for monitoring only.
- Timeframes: 5 minutes and above; hourly is usually enough.
- Data: delayed is fine for the scanner. Bot-traded instruments get the closest to real-time data IBKR offers.
- Strategies, in order: VIX spike spreads, 0DTE condors and butterflies, then squeeze setups.
- Starting account: $1,000 to $2,000. Early trades risk under $50.
- Backtest history: up to 20 years where data allows. Daily SPX expiries only began in 2022, so 0DTE tests will be shorter.
- Front end: React, with an open-source candlestick chart library whose licence is checked before it is added. This replaces the plain-JavaScript default in `PREFERENCES.md`. (Decided 16 Nov 2026.)
- Indicators in the browser: a TypeScript copy of the Python library, checked against the Python library's own numbers on every test run. (Decided 16 Nov 2026.)
- Sign-in: email and password through Supabase, as Field CRM does. Look and feel: Field CRM's, without its logo. (16 Nov 2026.)
- Daily candle top-up: a scheduled GitHub Actions job after each US close, loading the last 10 days. This settles where the loader runs; where the bot runs is still open. (Decided 16 Nov 2026.)
- First scans (16 Nov 2026): squeeze on, squeeze fired, and breakouts (close beyond the previous 20 candles' high or low, volume filter off) on daily and hourly; SPY trend break (below the 50-day average after being above), SPY drawdown (5% below the 60-day high) and SPY RSI divergence, each with the VIX alongside. Every number is an adjustable starting point for the backtester to test. Universe: the 8 test symbols for now.
- First backtest (17 Nov 2026): each SPY correction signal (trend break, drawdown, RSI divergence) studied against the VIX index with two exit rules side by side: (a) VIX +40% before -15%, within 20 trading days; (b) VIX touches 22 within 30 trading days, no stop, skipped if already at or above 22. Signal studies: the VIX index can't be traded, so no costs until option pricing is added. "Reached target" is the measure of working; "closed up" is shown alongside.
- Held-back period: the last 5 years. Build period 2 Jan 2006 to 16 Nov 2021; held back from 17 Nov 2021. (17 Nov 2026.)
- Chart pages: cards stay where they are dropped; a Tidy button closes gaps. (17 Nov 2026.)
- Development data: a free, unofficial candle source is used to build and test until IBKR or a paid source is in place. It sits behind the same loader interface so it can be swapped, every candle records it as its data source, and nothing tested on it is reported as validated. (Decided 16 Nov 2026.)

Still needed from Ben before the dependent work starts:

- [x] Supabase project and repository created, with access shared. (Project `stockwizard`, Sydney, 16 Nov 2026.)
- [x] Pointer to the existing repositories that define the app's visual conventions. (Field CRM, 16 Nov 2026.)
- [ ] IBKR account opened and funded, and which IBKR market-data subscriptions to buy.
- [ ] A source for 20 years of daily SPY and VIX data, and any paid intraday or options history.
- [ ] How IBKR applies day-trade rules to a $1,000 to $2,000 Australian account.
- [ ] Maximum loss per day, once real spread prices are known.
- [x] Exit rules for the first strategy: profit target, stop loss, time limit. (17 Nov 2026: two rules tested side by side, see Decisions.)
- [ ] Where the bot runs: home PC or a small VPS.

## Build order

Build in this order, and do not start a phase until the previous one meets its done-when. Ben confirmed this order on 16 Nov 2026. The indicator library and the backtest engine come before any screen that uses them.

| Phase | Build | Done when |
| --- | --- | --- |
| 0. Foundations | Repo layout, Supabase schema and migrations, data ingestion for daily and 5-minute candles, indicator library with tests | Candles load for a test symbol list, every indicator has unit tests, and a truncation test proves no indicator looks ahead |
| 1. Chart workspace | Candlestick charts, indicator overlays, drawing tools, saved workspace tabs and watchlists, installable web app | Ben can save a tab, reopen it on another device, and see the same chart and indicators |
| 2. Scanner | Scheduled scans for squeeze on, squeeze fired, breakouts and SPY correction signals; results table that opens the chart | A scan runs on schedule over the full universe and its results are stored and reproducible |
| 3. Backtester and research | Bar-by-bar engine, saved runs, metrics, walk-forward reports, VIX and SPY signal studies | A saved run can be re-run from its stored config and gives identical results |
| 3b. Pattern lab | Pattern search with a sealed held-out period, hypothesis counter, cross-symbol features, hand-off of survivors to the backtester (see Pattern lab section) | A search run stores its hypothesis count, a survivor is tested on the sealed period through the blind backtester, and discovery and held-out results are labelled separately |
| 4. In-app Claude | Server-side Claude panel with the tool limits in the security section | Claude can build an indicator and run a backtest from the app, and is blocked from every forbidden action |
| 5. Paper bot | IBKR adapter, safety rails, approval mode, audit log | Paper orders flow end to end with Ben approving each one, and every rail has a test that proves it blocks |

## Data model

Supabase holds everything, with row-level security on every table. Names are a starting point; keep them plain and keep migrations in the repo.

| Table | Holds |
| --- | --- |
| `symbols` | Ticker, market (US or ASX), instrument type, whether it is tradable or watch-only |
| `candles` | Symbol, timeframe, timestamp, open, high, low, close, volume, data source and version |
| `watchlists` | Named symbol lists, including the scanner universe |
| `workspaces` | Saved tabs: symbol, timeframe, indicator set, drawings, layout, order |
| `indicator_defs` | Indicator name, parameters and code version |
| `scans`, `scan_results` | Scan definitions and each run's matches with timestamps |
| `signals` | Every signal generated, with indicator values at that moment |
| `strategies` | Entry, exit and sizing rules as versioned configs |
| `backtest_runs` | Strategy version, parameters, data version, code version, date ranges, split between build and held-back data, and a reproducibility hash |
| `backtest_trades` | Every simulated trade with entry and exit timestamps, prices, fees and slippage |
| `backtest_metrics` | Per-run results, stored for both the build period and the held-back period |
| `safety_limits` | Per-trade and per-day loss caps, position caps, kill-switch state |
| `paper_orders` | Orders sent in paper mode, their approval, and fills |
| `audit_log` | Append-only record of every order, approval, limit change and Claude action |

## Backtesting engine

The engine replays candles one at a time, shows the strategy only the candles up to the current one, and its win rate must be a fair forecast of live trading. Ben's goal is a number he can trust, not a flattering one.

**Rules, all required**

1. Process candles strictly in time order. The strategy receives the current candle and earlier ones only.
2. Indicators use past candles only, and signals are evaluated when a candle closes.
3. Entries fill at the next candle's open, never on the candle that produced the signal.
4. Check every open position on every candle against exits: profit target, stop, time limit, opposing signal.
5. If a stop and a target are both reachable inside one candle, the stop is assumed hit first.
6. Charge commissions and slippage on every fill. For options, fill at the bid or ask, never the mid.
7. Log every trade with timestamps, so a run reads as a true timeline.
8. **Truncation test:** re-run with the final candles removed. Any signal on an earlier candle that changes is a look-ahead bug. This runs in automated tests and on every saved run.

**Validation**

- Split history into a build period and a held-back later period. Rules are developed on the first only, then tested once on the second. Report both side by side.
- Walk-forward testing across several windows, so one lucky period cannot carry a result.
- Treat a held-back result far better than the build result as a bug to investigate, not a win.

**Metrics saved per run:** trade count, win rate with a confidence range for 100 future trades, average win, average loss, profit factor, expectancy per trade, return after costs, maximum drawdown, longest losing streak and time in market.

**Saved runs** must be reproducible: store the strategy version, parameters, data version and code version, and re-running them gives identical results. Ben reviews saved runs in the app.

## First strategies to test

Test in this order: VIX spike spreads, 0DTE, then squeeze setups. Everything in the signal column is a hypothesis for the backtester to confirm or reject, not a known edge. Exit rules and parameters are set with Ben in the first sessions.

| Strategy | Signal idea | Structure | Expiry | Data |
| --- | --- | --- | --- | --- |
| VIX spike | SPY correction signals (trend break, divergence, drawdown from a high) while VIX is low, such as 14 to 15, targeting a move toward about 22 | Bull call debit spread on VIX options, short strike near the target | Weekly or monthly, chosen from backtests as the time the signal needs to play out plus a buffer | SPY and VIX daily and hourly, VIX futures, later VIX options |
| 0DTE | Opening range, prior close and gap, expected move, squeeze state | Iron condor, iron butterfly or butterfly on XSP or SPY, risking under $50 | Same day | SPY and XSP 5-minute, option chains |
| Squeeze setups | Squeeze fires on a 30-minute, hourly or daily chart, with momentum direction | Debit spreads when it fires, condors during compression | Days to weeks | Price data, options for pricing |

Important mechanics for the VIX strategy:

- VIX options are priced off VIX futures, not the spot VIX, so strikes and targets must be set against the futures price for that expiry.
- A contango curve works against long VIX calls and backwardation helps them, so record the term structure with every signal.
- Weekly VIX options expire on Wednesday mornings. Close positions before expiry rather than holding into settlement.

## Pattern lab (Phase 3b)

The backtester tests a strategy Ben has already defined. The pattern lab does the opposite: it searches history for setups that recur often enough and pay reliably enough to be worth defining as strategies. It sits after the backtester because every pattern it finds must be proven by that backtester before it counts.

**Core principle.** Discovery is allowed to see the future. Proof is not. The lab produces hypotheses; only the blind, bar-by-bar backtester on data the lab never saw can promote one to a strategy.

**Search inputs, chosen per run by Ben or Claude**

- Target symbol and timeframe (5 minute and up).
- What counts as a win, defined forward: for example +1.5% before -1% within 5 days, or a modelled call or put spread paying out.
- Instrument to exploit it with: shares, or a defined-risk option spread (payoff modelled from underlying moves, then checked against real fills where option history exists).
- Candidate features: indicator states (Bollinger, Keltner, squeeze, EMAs, momentum), candle shapes, volume or open interest where available, and the cross-symbol features below. Patterns need not be traditional chart patterns.
- Minimum frequency: a pattern must occur often enough to give a usable win-rate range.

**Method**

1. Split the data first: a discovery period, then a sealed held-out period the lab cannot read. Reserve the most recent years as the sealed period.
2. Search the discovery period with the future visible: rule mining, decision trees, clustering of similar chart shapes, and simple one-condition and two-condition scans.
3. Count every hypothesis tried and store the count with the run. Raise the evidence bar as the count rises (multiple-testing correction such as Bonferroni or false discovery rate, and a deflated-Sharpe style adjustment for any reported edge).
4. Reject patterns whose win rate disappears under small changes to their parameters. Prefer broad, stable conditions over razor-edge ones.
5. Send survivors to the sealed period through the existing bar-by-bar backtester, then walk-forward across later windows. Costs and slippage apply as normal.
6. Report each survivor with trade count, win rate with its confidence range, average win and loss, drawdown, and how many hypotheses were tried to find it.
7. A survivor can be saved as a draft strategy for Ben to review. It is never traded without Ben and the paper-bot gates.

**Cross-symbol features (lead-lag)**

- Same engine, with other symbols as inputs to the target. Examples: VIX as target with SPY trend and volatility, ES futures, SPX and XSP, VIX term structure (spot versus futures, VIX versus 3-month VIX) and breadth as inputs; the reverse direction too.
- Methods: lagged correlation, Granger-style tests, divergence and ratio features, and regime flags. Every feature is lagged correctly so only information available at the signal candle is used in the blind test.
- Hourly timeframes and up are realistic. Do not chase millisecond futures-to-ETF lead, which is arbitraged away and not exploitable here.
- Needs clean, timestamp-aligned data across symbols, and continuous futures contracts with a documented roll method.

**Data model additions:** `pattern_runs` (question, target, win definition, period split, hypotheses tried), `pattern_candidates` (rule definition, discovery stats, held-out stats, status) and `feature_sets` (cross-symbol inputs and their lags), linked to `strategies` and `backtest_runs`.

**Honest limits Claude Code must respect**

- Rare events give small samples. VIX spikes are perhaps 30 to 60 meaningful events in 20 years, so win-rate ranges will be wide and the app must show them.
- Option history is costly and short, so discovery runs on underlying prices and option payoffs are modelled until real fills are tested.
- Never present a discovery-period result as a win rate. Only held-out and walk-forward results are shown as expected performance, and the app labels the two clearly.
- The held-out period is single-use per hypothesis family. If Ben keeps tweaking after seeing held-out results, that period is burned and the app says so.

## Broker adapter and safety rails

The bot talks to Interactive Brokers only through a thin adapter, and no order can reach the adapter without passing every safety rail first.

**Adapter**

- Use the community-maintained Python library ib_async against TWS or IB Gateway. Community sources put paper on port 7497 and live on 7496; verify in IBKR's documentation.
- Keep the adapter behind a small interface so the broker can be swapped later without touching strategy code.
- Options orders are limit orders only, with multi-leg spreads sent as a single combo order.
- IB Gateway restarts daily and may need a fresh login. Detect disconnects, stop trading, and on reconnect reconcile positions and open orders with the broker before doing anything else.
- Paper and live use separate configuration and credentials. Live is disabled by default and cannot be enabled from the app.

**Safety rails, all enforced in code and each with a test**

1. Defined-risk structures only. No naked short options, ever.
2. Maximum loss per trade: under $50 in the early period, as a stored limit.
3. Maximum loss per day, a stored limit Ben sets once real spread prices are known. Reaching it halts new trades.
4. Caps on open positions and total capital at risk.
5. Stale-data stop: no new orders if prices or signals are older than a set age.
6. Kill switch: one action that cancels open orders, blocks new ones, and is recorded in the audit log.
7. Approval mode by default: the bot proposes a trade and waits for Ben to confirm. Automatic mode is a separate setting Ben turns on.
8. Every order, approval, rejection and limit change is written to the append-only audit log.

## In-app Claude and security

Ben wants Claude built into the app and free to work hard inside it, so give it wide research powers and none over live money or the safety rails.

**Claude in the app can**

- Read candles, signals, scan results and saved backtests.
- Create and edit indicator definitions, scan definitions and strategy configs, each saved as a new version.
- Run backtests and compare saved runs.
- Explain a result in plain language, including the held-back versus build-period gap.

**Claude in the app cannot**

- Place, modify or cancel any order, except proposing one for Ben's approval.
- Change safety limits, the approval mode, the kill switch, or the paper/live setting.
- Read secrets, broker credentials or API keys.
- Edit or delete audit log rows.

Every action Claude takes is written to the audit log.

**Security**

- The Anthropic API key and the IBKR credentials stay on the server or the machine running IB Gateway, never in the browser or in Supabase tables.
- The browser uses only Supabase's publishable key, and row-level security on every table decides what it can read or write. The service-role key stays server-side.
- Keep migrations in the repo and ask Ben before any destructive migration or data deletion.
- Check Supabase's security advisories after schema changes.

## Out of scope and working agreements

Nothing in this list is built unless Ben asks for it.

**Out of scope**

- Look and feel: colours, layout, typography, component styling. Follow the conventions in the repositories Ben points to.
- Native mobile apps, news, fundamentals, social features and multiple users.
- Live trading. It stays disabled until Ben passes the go/no-go gates: positive backtests after costs on held-back data, at least 3 months of paper trading close to the backtest, drawdown within his limit, and every safety rail tested.
- Trading ASX instruments. The ASX list is watch-only.
- Anything that copies Simpler Trading's proprietary tools. The squeeze is built from the publicly described method: Bollinger Bands inside the Keltner channel, plus a momentum histogram.

**Working agreements**

- Read this spec and the Proposal doc first, then confirm the build order with Ben.
- Write tests for the indicator library and the backtest engine before building screens on them.
- Flag anything ambiguous or any conflict with this spec instead of guessing.
- Keep commits small, and record each decision that changes this spec.
- Never report a result as validated unless it passed the truncation test and the held-back test.

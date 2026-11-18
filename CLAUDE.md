# Stock Wizard

A technical-analysis workspace: charts, a scanner, a bar-by-bar backtester, a
pattern lab and, last of all, a paper-trading bot on Interactive Brokers, all
backed by Supabase. Phases 0 (indicators, loader, database), 1 (the chart
workspace web app), 2 (the scanner), 3 (the backtester) and 3b (the pattern
lab) and 4 (Claude in the app) are built, plus chart
pages (cards on a grid, saved as views), indicator chips and favourites,
calls and puts placed on the chart, and phase 5's safety rails against a
pretend broker, and the Interactive Brokers adapter (written, waiting for Ben's paper account to be tested).

## Who you are working with

@PREFERENCES.md

That file is Ben's own, shared across his projects. Where it and this file
disagree, this file wins.

## Read first

| File | What it is |
|---|---|
| `SPEC.md` | The handoff spec: build order, data model, backtest rules, safety rails, in-app Claude limits. This is the brief. |
| `PROPOSAL.md` | The reasoning behind the spec: scope, indicator shortlist, broker comparison, risk and gates. |

Both are exports of Claude docs ("Trading Workspace: Handoff Spec for Claude
Code" and "Technical Trading Workspace: Proposal"). The repository copies are
the source of truth from here on; record any decision that changes the spec in
`SPEC.md` in the same pull request.

## Start here

Follow the working agreements at the end of `SPEC.md`: read both files, then
confirm the build order with Ben before writing code. Phase 0 needs the open
inputs listed under "Still needed from Ben" (Supabase project first).

## Files

| Path | What it is |
|---|---|
| `backend/stockwizard/candles.py` | The candle frame every part uses: UTC open times, checks that refuse bad data |
| `backend/stockwizard/indicators/` | The indicator library and its registry; bump an indicator's version when its maths changes |
| `backend/stockwizard/data/` | Candle sources behind one interface (the free Yahoo source for now) and the Supabase writer |
| `backend/stockwizard/load.py` | Loads a symbol list's candles into Supabase (the free Yahoo source; no longer scheduled) |
| `backend/stockwizard/data/ibkr.py`, `backend/stockwizard/data/archive.py`, `backend/stockwizard/run_data.py`, `pc/start-data.bat`, `backend/data/universe.csv` | Market data from Interactive Brokers (Ben, 18 Nov 2026): the data program on Ben's PC (read-only, client id 30) fetches the symbol list's candles into the local archive (`pc/data/archive.sqlite`, everything kept, backed up to OneDrive) and the recent window into Supabase (daily 5 years, hourly 2 years, 5-minute 60 days; older `ibkr` candles deleted); after each US close it adds the day, runs the scans and backs up. `data/base.py`'s `select_preferred` reads one source, IBKR first, never a mix |
| `backend/stockwizard/data/live.py`, `web/src/data/live.ts`, `live_bars` (table) | Live bars in US hours: the data program streams the symbol list from IBKR, writes today's 1-minute bars to `live_bars` every 5 seconds and IBKR's finished 5-minute candles every 5 minutes; the chart folds today's bars into its candles (`withLive`) every 5 seconds while the market is open, with a Live or Delayed badge |
| `supabase/functions/bot-key/`, `bot_accounts`, `claude_access` (tables), `web/src/ui/BotKey.tsx`, `pc/installer/`, `docs/SETUP-BOT.md` | Multi-user (18 Nov 2026): invited people share the market data; each person's bot signs in with a bot key (`SupabaseStore` with `BOT_KEY`, or Ben's `SUPABASE_SECRET_KEY`) as a bot account limited to that person's orders; Claude only for `claude_access`. The bot installer (Inno Setup, embeddable Python) is built by `pc/installer/build.ps1` on GitHub (`installer.yml`) and published as a release; the guide is for invited people |
| `backend/stockwizard/supervisor.py`, `pc/start-stockwizard.bat`, `pc_status` (table), `web/src/data/pcStatus.ts`, `web/src/ui/PcStatusLine.tsx` | One program on the PC (stages 1 and 2; `backend/stockwizard/pc_settings.py` is the Settings screen, pywebview the app's window): the supervisor runs and restarts the bot (and Ben's data program), logs to `logs/` beside the settings, an icon by the clock, one copy per PC, and a 30-second heartbeat to `pc_status` shown in the app as the PC status line (Today, Safety) |
| `backend/stockwizard/scans.py` | Scan rules: a signal for every candle, causal, truncation-tested; bump a rule's version when it changes |
| `backend/stockwizard/scan.py` | Runs the enabled scans and saves each run with what it used; `--rerun N` repeats a run and checks it matches |
| `backend/stockwizard/backtest.py` | The backtest engine: bar by bar, next-open fills, stop before target, costs per fill; metrics for build, held-back and 3-year windows. Pure, no database |
| `backend/stockwizard/run_backtests.py` | Runs the saved strategies and saves runs, trades and metrics; `--rerun N` repeats a run and checks it matches; marks the held-back period burned when settings change |
| `backend/stockwizard/option_backtest.py`, `backend/stockwizard/run_option_backtests.py` | Iron condor and iron fly backtests on SPY with modelled prices (Black-Scholes, the VIX as volatility): same-day (open to close) and multi-day (next open to expiry, held or closed at 50%), $0.65 a leg plus 5c slippage, every day or on signal days; truncation-tested; monthly (21 trading days): credit and debit spreads, iron condors, call and put condors, managed by expiry, take 50%, 21 days left or a 2× stop (family `spy_monthly`); runs saved in `option_runs`, shown in the Backtests screen's Options tab (`web/src/ui/OptionBacktests.tsx`) |
| `backend/stockwizard/intraday_options.py` | Same-day (0DTE) backtests on SPY's hourly candles: entry at the open or 10:30, volatility from the VIX or VIX1D, shorts from the daily range or the expected move, stops on the mid price; strategies with `"intraday": true` in `option_strategies` (family `spy_0dte_methods`) |
| `backend/stockwizard/features.py` | The pattern lab's measures of market conditions, one row per SPY day, all known at the close; other symbols matched by trading date (the VIX's daily candles are stamped an hour after SPY's) |
| `backend/stockwizard/lab.py`, `backend/stockwizard/run_lab.py` | The pattern lab: one- and two-condition patterns on the discovery years, every one counted, Benjamini-Hochberg check, stability check, survivors tested once on the sealed years by the backtester; `--rerun N` checks a run repeats |
| `supabase/functions/claude/` | Claude in the app (phase 4): `index.ts` (Opus 5.5, adaptive thinking, refusal fallback, the 100-a-day cap, the tool loop) and `tools.ts` (the only actions Claude has; none for orders, limits, keys or the audit log). `lib/` holds copies of `web/src`'s candles, indicators and engine: edit those in `web/src`, run `python3 tools/sync_function.py`; a web test fails if a copy differs. Deployed with the Supabase connection's deploy tool (all files), then checked by calling it. The Anthropic key is the Supabase secret `ANTHROPIC_API_KEY`, never in the repository |
| `backend/stockwizard/rails.py` | Phase 5's safety rails, pure: defined risk, per-trade and per-day loss, positions and capital at risk, stale data, kill switch, limit orders only. `check()` lists every rail an order fails |
| `backend/stockwizard/run_bot.py` | Runs the bot against Supabase: reads `safety_limits`, writes `paper_orders`, acts on Ben's approvals, rejections and the kill switch (approvals are re-quoted and every rail checked again), takes back open orders and today's losses on restart. Also acts on Ben's requests from the app (`bot_requests`): orders a chart structure (priced from IBKR's bid/ask midpoints, or the model `pricing.py` with the pretend broker), then the rails and approval mode decide; sends a close for a filled position. A close is a real order: the position stays open until it fills and is booked at the fill price (`check_closes`; `paper_orders.close_*`). `--practice` proposes one made-up order |
| `backend/stockwizard/broker/ibkr.py`, `pc/start-bot.bat`, `docs/PC-BOT.md` | The Interactive Brokers broker (ib_async, IB Gateway on Ben's PC): paper only, refusing live ports (4001, 7496) and any account not starting DU; one combo limit order per structure (a credit is a negative price); quotes from leg midpoints; reconciles leg by leg against the account's positions. Untested against IBKR until Ben's paper account exists; `tests/test_ibkr.py` uses a stand-in. The PC starter reads keys from `pc/stockwizard.env`, never committed |
| `option_quotes` (table) | Real SPY option quotes the IBKR bot records every 30 minutes in US hours (next 4 expiries, strikes within 2%): our own price history, so backtests can move from modelled to real prices |
| `backend/stockwizard/strategy_runner.py`, `web/src/ui/Strategies.tsx` | The bot's own strategies (`bot_strategies`, switched on in the Safety screen): in the 15 minutes after a strategy's entry time, once a day, the bot reads today's 5-minute bars, works out the signals, chooses strikes by delta, prices at the natural side and proposes (rails and approval as usual; a no-trade day is recorded once); it manages exits on filled trades and settles everything open at the close. Multi-day strategies (`dte`; 3, 9 or about 21 trading days): one at a time, held overnight, settled at the expiry's close; condor shorts by delta or daily range (`short_atr`); NYSE holidays in `zerodte/calendar.py`. Market from the free source and the model with the pretend broker, from IBKR with the IBKR broker |
| `web/src/data/bots.ts`, `web/src/ui/MakeBot.tsx`, `web/src/data/botsOnChart.ts` | Bots made from backtests: Make a bot on an option backtest or 0DTE survivor maps its settings to the bot's and keeps the source (`bot_strategies.source`); only a bot whose settings still equal the tested ones can be switched on; the Bots cards compare paper results with the backtest; open bot positions (teal) and entry and close marks on the chart |
| `backend/stockwizard/bot.py`, `backend/stockwizard/broker/` | The only path from an order to a broker: propose, rails, Ben's approval, rails again, send; kill switch; reconcile after a reconnect; every step audited. `PretendBroker` stands in for IBKR; a live broker is refused outright |
| `web/src/data/options.ts`, `web/src/ui/OptionSheets.tsx` | Calls and puts on the chart: structures, default placement (one daily range out, $5 wings), moving whole, by side or by leg. Plans only, saved in `option_positions` |
| `web/src/data/pricing.ts`, `web/src/ui/Analysis.tsx`, `web/src/ui/Graph.tsx` | Options analysis on theoretical prices (Black-Scholes, 4% rate, volatility from the VIX for SPY or 20 days' moves otherwise): profit and loss across prices at expiry and at a chosen date, time decay, Greeks, chance of profit, expected move; up to 3 structures compared. Graphs are hand-drawn SVG. Opened by tapping a structure's chip |
| `web/src/data/usePositions.ts` | Option structures and favourites (indicators shown in the Indicators sheet; structures in the row above the chart, shared or per symbol), kept on the device and saved to Supabase |
| `web/src/data/unsaved.ts` | Changes waiting to be saved are kept on the device too, so closing the app straight after a change loses nothing; used by tabs, chart pages, structures and favourites |
| `web/src/ui/Safety.tsx` | Safety and orders (⋯ menu): kill switch, orders waiting for approval, the limits. No live-trading control anywhere |
| `web/src/engine/` | TypeScript copies of the scan rules and the backtester, for the Claude function; checked trade by trade against the Python library (golden.json) |
| `web/src/ui/ClaudePanel.tsx`, `web/src/data/claude.ts` | The Claude panel: ask at the top, newest answer under it; the conversation kept in the browser and sent unchanged (thinking blocks included) |
| `web/src/ui/Lab.tsx` | The Pattern lab tab of the Backtests screen |
| `web/src/ui/Backtests.tsx` | The Backtests screens: each strategy's build and held-back results side by side, the windows and every trade |
| `web/src/ui/Scanner.tsx` | The Scanner screen: the latest run of each scan, in tabs |
| `web/src/ui/Pages.tsx`, `web/src/data/grid.ts`, `web/src/data/useViews.ts` | Chart pages: up to 10 tabs as cards on a 12-column grid, dragged and resized with snapping on the PC, one per row on the phone; tap for full screen |
| `web/src/data/kitty.ts`, `web/src/ui/Kitty.tsx` | "If you'd started with $5,000" on each backtest page: the trades in order, each risking 2% of the balance (options: as many structures as keep the worst case under 2%, else skipped; stocks: sized from the stop, or 10% without one); all years and held-back years. `zerodte/stats.kitty` is the Python twin for the 0DTE research |
| `backend/stockwizard/notify.py` | Phone notifications through ntfy: order waiting, filled, closed or stopped, daily limit reached; told once at the end of a bot cycle. The topic is the secret `NTFY_TOPIC` (GitHub, `pc/stockwizard.env`); none without it |
| `web/src/ui/Today.tsx`, `market_snapshots` (table) | Today (header button): market open or closed in Sydney time, the bot's latest snapshot (saved each cycle in US hours by `strategy_runner.snapshot`), Fed and expiration-Friday tags, each strategy's state today, orders waiting, today's result against the daily limit |
| `web/src/ui/Help.tsx` | Help (⋯ menu), a guide: getting started, the screens, the bot and safety, troubleshooting, terms; each topic folded; a full-screen search. Baseline of 18 Nov 2026 |
| `docs/GUIDE.md`, `docs/OPERATIONS.md`, `CHANGELOG.md` | The user guide (what each part does, how backtests are judged, bots and the rails), how it runs (where everything lives, keys, schedules, numbered fixes), and the changelog (one line per pull request). Ben's decision (18 Nov 2026): Help and these docs are refreshed only when he asks, not with every change; until then, a change that makes a statement in them wrong is listed in the pull request so the next refresh catches it |
| `web/src/update.ts` | "Get latest version" in the ⋯ menu: clears only Stock Wizard's own caches and service worker (the address is shared with Ben's other apps), then reloads fresh |
| `backend/tests/` | Truncation test on every indicator, hand-worked values, loader tests, a test per safety rail proving it blocks (`test_rails.py`). Made-up candles and orders only |
| `backend/tools/make_golden.py` | Writes `web/src/indicators/golden.json`, the Python library's numbers the browser copy must match |
| `web/` | The web app: React, Vite, TypeScript, Lightweight Charts (TradingView, Apache 2.0; keep its logo link on) |
| `web/src/indicators/` | The browser's copy of the indicators. Change it with the Python library, regenerate `golden.json`, and both test suites must pass |
| `web/src/data/` | Candles, the saved shapes (`model.ts`), the Supabase and made-up data stores, workspace saving |
| `web/src/chart/Chart.tsx` | The chart: candles, overlays, indicator panes, drawings, taps |
| `web/src/ui/` | Screens, sheets and styles. The look is Field CRM's (`benjaminkeithrose-svg/CRM`, `index.html`), without its logo |
| `web/public/sw.js` | Service worker. `CACHE` must equal `stockwizard-` + `APP_BUILD` in `web/src/config.ts`; bump both on every change to the app |
| `supabase/migrations/` | Database changes, one file per change, applied in order |
| `.github/workflows/` | `pages.yml` publishes the app on each merge (the daily candle top-up and the scans moved to the PC data program, 18 Nov 2026); `keepalive.yml` pings Supabase twice a week so the free project isn't paused; `backtests.yml` runs the backtests, the option backtests and the pattern lab by hand from the Actions tab; `bot.yml` runs a paper-bot cycle with the pretend broker every 10 minutes through the US session on weekdays, and by hand (turn the schedule off once the bot runs on Ben's PC) |
| `backend/stockwizard/zerodte/`, `backend/stockwizard/run_0dte_research.py` | The 0DTE research framework (stage 2 of Ben's brief): instruments with fees, a quote source (the model now, recorded or bought real quotes later), opening range and VWAP signals, strikes by delta, fills at the bid and ask, profit targets, stops (credit multiple, breach, delta) and time exits, statistics by period and regime, and the experiment matrix with the false-discovery check, validation, walk-forward blocks and an untouched final period. Reports go to `docs/research/results/` and each run is saved in `research_runs` (`--publish FILE` saves a past run) for the Backtests screen's 0DTE tab (`web/src/ui/Research.tsx`) |
| `docs/research/0DTE-RESEARCH.md` | Stage 1 of Ben's 0DTE research brief: the market, instruments, academic and commercial evidence, data providers and costs, with sources |
| `IDEAS.md` | Ben's ideas not yet scheduled. Add to it rather than building unasked |
| `supabase/tests/` | Row-level security checks, run on a local Postgres with a stand-in for Supabase's sign-in |

## Supabase

Project `stockwizard` (ref `cxpspihahmztfydvdwpd`, Sydney). Every migration in
`supabase/migrations/` is applied to it; check the security advisors after
each one. Keys never go in the repository: loaders read `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` from the environment.

## Publishing

A merge to `main` runs `.github/workflows/pages.yml`: the web tests, the
build, then GitHub Pages at https://benjaminkeithrose-svg.github.io/stockwizard/.
The repository is public (Ben's decision, 16 Nov 2026), so nothing private
goes in it. Pages puts Field CRM on the same web address, so every browser
storage name starts with `stockwizard` (local storage, the sign-in key, the
service worker's cache) and never touches Field CRM's.

## Testing

```
cd backend && pip install -e ".[test]" && python -m pytest     # Python: indicators, loader, golden file
cd web && npm install && npm test                             # browser copy of the indicators, app logic
cd web && npm run build && NODE_PATH=$(npm root -g) node tests/browser.mjs   # the built app in Chromium
bash supabase/tests/run_local.sh                              # migrations and security rules, local Postgres
```

`npm install` needs `legacy-peer-deps` (set in `web/.npmrc`) because of an
npm bug with these versions. The browser test opens the app with `?demo`:
made-up candles, everything kept in the browser, no network. None of these
touch real market data, the live Supabase project or a phone. Say which ran.

## Hard rules

- No look-ahead anywhere. Nothing is reported as validated unless it passed
  the truncation test and the held-back test.
- No order logic before the safety rails exist. Live trading stays disabled
  and cannot be enabled from the app.
- No secrets in the repository, the browser or Supabase tables.
- Look and feel follows Ben's existing repositories; do not design the
  interface. `SPEC.md` overrides `PREFERENCES.md` where they differ (for
  example, the spec's Python and Supabase stack).

## Git

Work on a branch and open a pull request; never push to `main`. When a pull
request is ready, end with a tap-to-answer question asking whether to merge
it, "Merge it" first. Never force-push or rewrite history.

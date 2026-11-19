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
- Pattern lab (17 Nov 2026): first question "what SPY conditions come before the VIX rising 30% or more within 10 trading days?" over about 20 SPY, VIX and 3-month VIX measures; one- and two-condition patterns at the discovery years' 10/20/30/70/80/90th percentiles; at least 20 episodes; Benjamini-Hochberg false-discovery check at 0.05 across every pattern tried; stability against the neighbouring percentiles. Discovery 2006 to 16 Nov 2021, sealed from 17 Nov 2021 (the last 5 years). The deflated-Sharpe adjustment named in the method is not built yet: survivors are judged on their target rate, not on a reported edge.
- Claude in the app (17 Nov 2026): Claude Opus 5.5 with adaptive thinking at medium effort, refusals falling back to Anthropic's recommended model; at most 100 requests a day; runs in a Supabase function holding the key; backtests it runs use the TypeScript copy of the engine, checked against the Python one. The conversation lives in the browser. Audit log is append-only, enforced in the database.
- Backtest filter (17 Nov 2026): a strategy can take a signal only when another symbol's close that day is at or below (or at or above) a level, matched by trading date. First use: the six VIX-low studies, VIX at or below 15.
- Indicator chips (17 Nov 2026): every indicator on a chart is a chip above it, × to remove, tap for its settings; a favourites row (indicators with their settings, and option structures; 20 at most, saved to the account) adds one in a tap.
- Calls and puts on the chart (17 Nov 2026): iron condor, iron fly, credit and debit spreads, single call or put. A new one is placed one daily range (ATR 14 of daily candles) either side of the latest session's mean price, wings $5 beyond, strikes on $1 steps ($0.50 under $25); expiries are the next 15 weekdays. Dragged on the chart whole, by side, or by leg. Planned in purple, marked bought in green by hand, shown on every chart of the symbol (backtest screens excepted). Plans only: no option prices until IBKR is connected, and nothing is sent.
- Safety rails (17 Nov 2026): built and tested against a pretend broker before the IBKR adapter. Starting limits: $50 a trade, daily limit empty (every order refused until Ben sets it), 1 open position, $100 at risk, prices under 120 seconds old, approval mode. Also enforced: limit orders only, one expiry per order, broker connected and reconciled after any reconnect, and a live account refused outright. Ben approves or rejects in the app's Safety screen; the bot checks every rail again before sending an approved order. The kill switch in the app drops waiting orders and the bot cancels working ones.
- The bot and Supabase (18 Nov 2026): the bot reads Ben's limits from `safety_limits` and writes every proposal and change to `paper_orders`. An approval made in the app gets a fresh quote and every rail checked again before it is sent. Approval-time staleness is judged on the fresh quote, not the original. On restart the bot takes back its open orders and today's losses and reconciles with the broker before anything else. Until the Interactive Brokers adapter exists it runs only with the pretend broker.
- Today screen and night approvals (18 Nov 2026): a Today screen (header button on the chart) shows whether the US market is open, in Sydney time; the bot's latest market snapshot (`market_snapshots`, saved every cycle during the session: SPY price, VIX, VIX1D, expected move, opening range, VWAP, direction); Fed and expiration-Friday tags; each switched-on strategy's state today; orders waiting; and today's result against the daily limit. For overnight paper trading Ben chose automatic approval, which he switches on himself in Safety and orders. The rails still check every order, and live trading stays impossible.
- Phone notifications (18 Nov 2026): through ntfy (free app, Ben's choice). The bot tells an order waiting for approval, filled, closed (with why: target, time, by Ben, settled) or stopped, and the daily loss limit reached, each once, at the end of the cycle. The topic name is a secret (`NTFY_TOPIC` in GitHub's secrets and `pc/stockwizard.env`); without it nothing is sent. A failed notification never stops trading. What leaves: symbol, structure, strikes, prices, profit or loss.
- Multi-day strategies for the bot (18 Nov 2026): a strategy can expire the same day, in 3 or 9 trading days, or in about a month (`dte`, counted as in the option backtests: the entry day is day 1). One position at a time per strategy; held overnight; settled at the expiry's close. Condor shorts can be placed by daily range (`short_atr`, as backtested) instead of by delta. Multi-day prices use the VIX, not VIX1D. Two differences from the backtests: entry is at the strategy's entry time, not the open, and the profit target is checked each cycle, not only at the daily close. NYSE holidays (2026 and 2027) are listed in `zerodte/calendar.py`; the bot doesn't trade on them.
- Monthly option backtests (18 Nov 2026): family `spy_monthly`, 24 strategies. Bull put and bear call credit spreads, bull call and bear put debit spreads, iron condors, and call and put condors (four strikes of one type, bought). All expire 21 trading days out and open every day the strategy isn't in a trade, so both sides of each spread are tested with no direction rule. Each is managed one way: held to expiry; take 50% of the most it can make; close at 21 calendar days left (about 6 trading days in, since the trades open with about 30 days to go); or a stop at twice the credit (credit structures only). Shorts or inner strikes sit 3 daily ranges out, with $5 wings; debit spreads buy at the money. Every management check is at a daily close. Call and put condors have the same payoff as the iron condor on the same strikes, so the model gives them the same results; in practice they differ only in fills and early assignment.
- Chips and favourites (18 Nov 2026): the row above the chart holds option structures only, meaning those placed and the favourites. Indicators live in the Indicators sheet: the toolbar button shows how many are on, and the sheet lists them, then favourite indicators to add in one tap, then the full list. Favourite structures are shared (the star) or kept to one symbol (the symbol button), for example iron condors on SPY and credit spreads elsewhere.
- Bot set-up, built (18 Nov 2026). Limits: stock strategies and Pattern lab survivors are stock signals and can't be bots until the bot trades stock; same-day methods (hourly candles) and call or put condors can't either, and say so. A bot made from an option backtest enters at 10:00 New York (the backtest uses the open) and checks its exits each cycle (the backtest, at each daily close). The bot's own runner gained the backtests' management: close at N days left, take profit as a share of the most a structure can make (so debit spreads too), shorts by daily range for credit spreads, and a daily signal (a scan rule at the previous close). The plan, as agreed (Ben, 18 Nov 2026): a **Make a bot** button on every backtest page (options, 0DTE survivors, stock strategies, Pattern lab survivors) opens the bot sheet already filled in from that test, with its held-back result and $5,000 figure. Only tested settings can be switched on; changing one marks the bot untested until it's backtested again. A Bots list replaces "Strategies the bot runs": each card shows on or off, today's state, and paper results against what the backtest expected. Bot entries, open legs and past trades are drawn on the chart in a bot colour. Today stays the summary; approvals, rails and the kill switch are unchanged.
- Help and documentation (18 Nov 2026): baseline set. In-app Help is a guide (getting started, screens, the bot and safety, troubleshooting, terms, with search); `docs/GUIDE.md`, `docs/OPERATIONS.md` and `CHANGELOG.md` sit beside it. Ben chose to have them refreshed only when he asks, not with every change, until the system is fully running. This overrides PREFERENCES.md's "keep Help in step in the same pull request".
- Option lines on the chart (18 Nov 2026): each leg's line carries only ▲ (call) or ▼ (put) and its strike on the price axis; colour still shows planned (purple) or bought (green), solid for a short leg, dotted for a long one. Touching or hovering on a line shows the leg, structure, expiry and days left, and status.
- The $5,000 kitty (18 Nov 2026): every backtest page shows what a theoretical $5,000 would have become, with each trade risking 2% of the balance at the time (Ben). Options: as many structures as keep the worst case at or under 2%; a trade where even one is over 2% is skipped and counted. Stocks: a position sized so the stop loses 2%, or 10% of the balance when there's no stop. Shown over all years and over the held-back years.
- The bot's own strategies (18 Nov 2026): Ben adds 0DTE research configurations in the Safety screen (presets for the brief's strategies A, B and C, on XSP at $1 wide) and switches them on (asks first; every change audited). At the entry time the bot proposes the trade at the natural price; the rails and approval mode decide as for any order. The bot manages exits on filled strategy trades and settles open positions at the 16:00 close at intrinsic value. With the pretend broker, today's prices come from the free source's 5-minute candles and the model.
- 0DTE research framework (18 Nov 2026, stage 2 of Ben's brief): `backend/stockwizard/zerodte/`. Fills are never at the mid: sell at the bid, buy at the ask, plus fees per instrument (estimates). Exit rules trigger on the mid and fill at the worse side. The matrix runs every strategy on a development period, applies the Benjamini-Hochberg check (q = 0.10) across everything tried, then runs survivors once on validation and in four walk-forward blocks; the final period (from 1 Apr 2026) is untouched unless `--final`. Research covers every width; the $50 limit applies only to what is traded (Ben). On hourly candles the opening range is the first hour, so at 10:30 direction falls back to VWAP and the day's open. Inflation and jobs days aren't tagged until their dates are checked.
- Option time is trading time (18 Nov 2026): every option price (app, bot, backtests) counts time to expiry in trading sessions (6.5 hours a session, 252 a year), not calendar time, which understated same-day options by more than half. Option backtests from before this (code `+options1`/`+options2`) are superseded by `+options3` runs. Stops trigger on the mid price and pay slippage on the exit.
- Same-day methods (18 Nov 2026): `intraday_options.py` tests the open against 10:30 entries, the VIX against VIX1D, range-based against expected-move strikes, and stops at 1× or 2× the credit, on SPY's free hourly candles (since Nov 2024; the last year held back). VIX1D added to the symbol list. Results are modelled and disagree with each other (VIX-priced condors look profitable, VIX1D-priced ones don't), so none is evidence; real option quotes are needed.
- Sized to the $50 limit (18 Nov 2026): option backtests can skip any trade that could lose more than a cap (`max_loss_cap`), as the bot's per-trade rail would. At $50 only $1-wide iron flies near the price fit; condors far enough out don't collect enough to cover a $1 wing. First $50-capped results all lose, as costs ($2.60 commission and 20c slippage on a ~60c credit) take most of the credit. Family `spy_fly_50`.
- Recording real quotes (18 Nov 2026): with Interactive Brokers connected, the bot saves SPY option bid/ask/last and implied volatility every 30 minutes in US hours, for the next 4 expiries and strikes within 2% (`option_quotes`), so backtests can later use real prices.
- Day-trade rules for a $1,000–2,000 account: still open. FINRA reportedly removed the $25,000 pattern-day-trader minimum from 4 June 2026, but IBKR says accounts may stay under the old rule through a transition to October 2027, and nothing found covers IBKR Australia specifically. Ask IBKR support before trading 0DTE.
- Interactive Brokers adapter (18 Nov 2026): ib_async against IB Gateway's paper port 4002 on Ben's PC, client id 17. Refuses the live ports and any account not starting DU, so live trading can't happen even by mistake. One combo limit order per structure, a day order; a credit is a negative combo price (to confirm on the first paper orders). Quotes from leg bid/ask midpoints on a 5c tick; delayed data is stamped 15 minutes old so the stale-data rail refuses it. After a reconnect, filled structures are checked leg by leg against the account's option positions, and anything unexplained stops trading. Started with `pc/start-bot.bat`; set-up steps in `docs/PC-BOT.md`.
- Option-structure backtests (18 Nov 2026): SPY iron condors and iron flies with modelled prices, as no option history exists yet: Black-Scholes with the previous close's VIX. Daily candles only (20 years), so two styles: same day, open at the open and settle at the close; multi-day, open at the next open after the signal and expire N trading days in, held to expiry or closed at the first daily close showing half the credit (both shown). Costs $0.65 a contract a leg plus 5c a leg slippage each way. Every day as a baseline and on signal days. One trade at a time. Same build and held-back split. 0DTE results before 2022 are hypothetical (SPY had no daily expiries).
- Real prices and closes booked on their fill (Ben, 18 Nov 2026): with Interactive Brokers, a chart order and a close from the app are priced from the legs' bid/ask midpoints, never the model; with no quote (market shut, data not subscribed) the request fails with the reason. A close is a real order: the position stays open until it fills, and its profit or loss is booked at the actual fill price (`paper_orders.close_broker_id`, `close_price`, `close_reason`); a close cancelled unfilled leaves the position open; a close that filled while the bot was away is booked at its limit (the worst case for a limit order). The kill switch leaves a working close alone. Supersedes "closes at the current theoretical price" below for the IBKR broker; the pretend broker keeps the model.
- Ordering from the chart (18 Nov 2026): a structure's analysis screen has Order (paper), which adds a request for the bot (`bot_requests`; the app can add requests but never change them, and each is audited). The bot prices it (theoretical Black-Scholes until IBKR quotes), puts it through every rail, and it waits for Ben's approval like any proposal. Filled paper positions have Close (paper): the bot closes at the current theoretical price, and a loss counts against the day's limit. Closing reduces risk, so it isn't held for approval or stopped by the kill switch. Requests are handled when the bot runs.
- Options analysis (18 Nov 2026): built on theoretical prices before any option data: Black-Scholes with a fixed 4% rate; volatility from the VIX for SPY, otherwise the last 20 days' moves, adjustable with a slider and badged as an estimate. Shows profit and loss across prices at expiry and at a date chosen on a slider, time decay if the price stays put, the Greeks, chance of profit (held to expiry), break-evens and the expected move; up to 3 structures compared on one graph and in a table. Every price is labelled Theoretical until IBKR quotes replace them. Built in Stock Wizard's own style, not copying TradeStation or tastytrade.
- One program on the PC, stage 1 (Ben, 18 Nov 2026): `stockwizard.supervisor` runs the bot (and on Ben's PC the data program) as background processes with no console windows, keeps their logs, starts a stopped one again a minute later, shows their state on an icon by the clock (pystray, Pillow), and every 30 seconds writes a heartbeat to `pc_status` (one row a person; their bot account may write their own). The app shows it as the PC status line on Today and Safety, on any device; over 2 minutes old reads as the PC or the program being off. Only one runs on a PC (a reserved local port), as two bots on one TWS would clash. The installer starts it; Ben starts it with `pc/start-stockwizard.bat` (replacing start-bot.bat and start-data.bat). Ben's bot reads his user id from `STOCKWIZARD_OWNER`, as others now have accounts. Stage 2 (Ben, 18 Nov 2026): the app in its own window (pywebview on Windows' Edge engine, loading the published app, sign-in kept in a storage folder beside the settings); closing it hides it while the bot keeps running, Quit on the icon stops everything; opening Stock Wizard again brings the running window forward (or its settings). A Settings screen (`pc_settings.py`) replaces Notepad: bot key (never shown back), TWS or IB Gateway, delayed data, ntfy topic, and on the secret-key PC the data-program switch (RUN_DATA); Done saves, keeps other lines and restarts the programs. Stage 3 (Ben, 18 Nov 2026): Ben's PC runs the installed program too: the data program inside it (RUN_DATA=1 with the secret key), the secret key stored encrypted with Windows' data protection (SUPABASE_SECRET_KEY_PROTECTED; a plain key is encrypted in place at start and only decrypted in memory), the settings, archive, logs and window storage in %LOCALAPPDATA%/StockWizard, and the pc folder's start files retired. On an update the installer starts from the person's own choices. Stage 4 (Ben, 18 Nov 2026): updates from inside the program (`updates.py`): it checks GitHub's latest release at start and every 6 hours, says so by the clock, and the icon's menu offers the update; taking it downloads the installer, checks GitHub's size and SHA-256 fingerprint, runs it silently in place (settings kept) and Stock Wizard reopens. Not during the US session (the bot would stop for about a minute). The install records its release number in VERSION; a copy run from the repository never updates.
- Multi-user (Ben, 18 Nov 2026): people Ben invites (Supabase invitations; sign-up off) share his market data, scans and backtest and research results, read-only, and keep their own charts, bots, limits and orders. Each person's bot runs on their own PC against their own Interactive Brokers paper account and signs in as their own bot account (`bot_accounts`, `bot_owner()`), made by the `bot-key` function and handed over as a bot key (app: ⋯, Bot key): it can read their limits, bots and structures and place and update their orders, answer their requests and write their audit log, nothing else. The app still can't change an order. The secret key stays on Ben's PC for the data program, which refuses to run without it; market snapshots and recorded option quotes are written only with it. Claude in the app only for people in `claude_access` (Ben), checked in `claude_take`. The bot is packaged as an installer for any Windows PC (`pc/installer`, built and published by `.github/workflows/installer.yml`): its own Python, no administrator rights, asks for the bot key, TWS or IB Gateway and delayed data, settings in %LOCALAPPDATA%\StockWizard\stockwizard.env, starts with Windows. Setup guide: `docs/SETUP-BOT.md`.
- Getting around and dark mode, from Financial Vault (Ben, 18 Nov 2026; picks 1, 3, 4 and 6 of the comparison): one full-screen menu with every screen in groups (Charts, Research, Trading, Settings and help) and Look and feel at its foot, replacing the ⋯ menu; the same header on every screen (home and back on the left; Today, Claude and Menu on the right; Scanner, Chart pages and Backtests moved into the menu); a path bar under the header from two screens deep, each step tappable, with back going up that path; Light, Dark or Match device, kept per device (`stockwizard.theme`), the chart following it. Otherwise the look stays Field CRM's. Not taken: pinning the menu to the side, a search across everything, colour schemes and Bold/Soft styles, a logo, switching sections off, draft notices.
- Live bars (Ben, 18 Nov 2026): during the US session the data program streams every symbol on the list from IBKR (market data type 3: real-time where subscribed, delayed otherwise), samples each once a second into today's 1-minute bars and writes the changed ones to Supabase's `live_bars` every 5 seconds (today only; a delayed bar sits at the time it traded and is marked delayed). Every 5 minutes it also saves IBKR's finished 5-minute candles, so the 5-minute chart and the scans stay current through the day. The open chart reads today's bars every 5 seconds while the market is open and it's on screen, folds them into its candles on any timeframe after the last stored candle (IBKR's grid: from 9:30, on the hour for 1h, New York midnight for 1d) and shows Live or Delayed. Page cards don't move.
- Market data from Interactive Brokers, archived on the PC (Ben, 18 Nov 2026): IBKR replaces the free source for candles, through the data program on Ben's PC (`run_data.py`, `pc/start-data.bat`; read-only, client id 30, beside the bot). Everything fetched is kept in a local archive (`pc/data/archive.sqlite`, never committed, backed up daily to OneDrive\StockWizard); Supabase keeps only the window the app shows: daily 5 years, hourly 2 years, 5-minute 60 days (source `ibkr`, older IBKR candles deleted each run). The long free-source history of SPY, QQQ, IWM and the VIX family stays in Supabase for the existing backtests until they run on the PC from the archive. The symbol list is `backend/data/universe.csv`: the big indexes, the VIX family, liquid ETFs, the largest companies and defence. With no Yahoo fallback, nothing updates while the PC or TWS is off; the next start fills the gap. After each US close the data program adds the day's candles, runs the scans (moved from GitHub) and makes the backup. Readers that pick a source use IBKR's candles when a symbol has any, never a mix of two sources. Live day-session bars and backtests on the PC follow in later stages.
- Backtests on the PC, Yahoo removed (Ben, 18 Nov 2026): the backtests, option backtests, pattern lab and 0DTE research read candles from the PC archive (`data/archive_store.py`; everything else still goes through Supabase), started from the icon by the clock (Run backtests, only on the PC with the secret key). The archive holds IBKR's daily history as far back as IBKR goes (SPY from 1993, the VIX from October 2005, VIX3M from August 2009; `run_data --deepen`) and a copy of the free Yahoo candles (`data/keep_yahoo.py`), used only for the years before IBKR's first candle; runs on that joined history are recorded as source `ibkr+yahoo-unofficial` and keep the app's free-data warning, so they are not reported as validated. Yahoo's code (`data/yahoo.py`, the yfinance extra) and the GitHub backtest workflow are removed; the cloud pretend bot reads today's 5-minute candles from Supabase. Yahoo's candles are deleted from Supabase once the archive copy is checked; BHP.AX (Yahoo only) has no candles until IBKR supplies them. IBKR's older daily candles have a few misplaced-decimal highs and lows (SPY 10 days, IWM 6, 2004 to 2009): the archive keeps them as sent and backtests read them repaired (Ben, 19 Nov 2026): a high above 1.5 times the larger of open and close becomes that, a low below the smaller divided by 1.5 becomes that.
- Same-day strategies on IBKR's hourly candles (Ben, 19 Nov 2026, option 2 of 3): IBKR's hourly candles run 09:30-10:00 and then on the hour, so the second entry time moved from 10:30 to 10:00 (migration `20261119150000_intraday_entry_1000.sql`) and the tests read IBKR's hourly candles instead of Yahoo's frozen half-hour ones. The six strategies that changed have their held-back years burned; the two entering at the open keep theirs.
- Traditional patterns and linked symbols in the Lab (Ben, 19 Nov 2026): `patterns.py` detects 18 candlestick and chart patterns on daily candles, each true only on the day it's complete (a chart pattern on its confirmation day), truncation-tested. The pattern lab's measures (`features.py`, 99 of them) add SPY's patterns and, for QQQ, IWM, NVIDIA, Apple and Tesla, today's and 5-day moves, relative strength against SPY, 20-day correlation with SPY, RSI, distance from the 50-day average and six patterns. Three questions are searched: SPY up 2% within 5 days, SPY down 2% within 5 days (tested on SPY's prices turned upside down, 1 / price, by the same backtester), and the VIX up 30% within 10 days. The sealed years count as used per question; the code version is 0.5.0, so older runs aren't re-run against the new measures. Market internals (NYSE TICK, advance and decline) and pattern markers on the chart come later.
- The Lab (Ben, 19 Nov 2026): Backtests and the pattern lab became one screen, the Lab, from an idea to a strategy trading on paper: Ideas (the pattern lab, the 0DTE research), Backtested (every tested strategy with a verdict from its held-back years: Held up if the held-back average trade made money over at least 10 trades, Didn't hold up, Too few to tell, Burned) and Paper trading (automated strategies with paper results against the backtest). While trading is paper-only, paper trading a strategy and automating it are the same step (Start paper trading). Run backtests on this PC is also in the Lab, through the PC program's bridge.
- Setup inside the app (Ben, 19 Nov 2026): the installer asks nothing (settings start with TWS's paper port 7497, real-time prices); a fresh install opens straight away and waits quietly (amber, "Not set up yet") until Setup (Menu, Setup; opened by itself the first time) connects it. Inside the PC program the app talks to the program through a pywebview bridge (`Bridge` in `supervisor.py`, `web/src/data/pc.ts`): it makes the access key and saves it there, saves prices, the ntfy topic and Ben's market-data switch, checks TWS, and never reads a key back. Screens: each monitor can get a job (Main chart, Watch page, Trading); Stock Wizard opens a window on each (`?view=`), saved as `SCREENS`. Anything on the app's web address can call the bridge inside that window: it only accepts access keys and settings, so the worst case is a changed setting.
- Plain names (Ben, 19 Nov 2026): it's a trading platform, not a bot. On screen, in the PC program, the installer and the guides: Stock Wizard (installer `StockWizardSetup.exe`, Start menu Stock Wizard; releases `v0.2.N`, also published under the old name for 0.1.x updaters), Access key (was bot key), Automate this strategy and Automated strategies (were Make a bot and Bots), "your PC" for the program that trades, and the PC line says trading and market data. Code, tables and log file names keep `bot`.
- Development data: a free, unofficial candle source is used to build and test until IBKR or a paid source is in place. It sits behind the same loader interface so it can be swapped, every candle records it as its data source, and nothing tested on it is reported as validated. (Decided 16 Nov 2026.)

Still needed from Ben before the dependent work starts:

- [x] Supabase project and repository created, with access shared. (Project `stockwizard`, Sydney, 16 Nov 2026.)
- [x] Pointer to the existing repositories that define the app's visual conventions. (Field CRM, 16 Nov 2026.)
- [ ] IBKR account opened and funded, and which IBKR market-data subscriptions to buy.
- [ ] A source for 20 years of daily SPY and VIX data, and any paid intraday or options history. (18 Nov 2026: IBKR supplies 20 years daily and the last 2 years hourly into the PC archive; options history still open.)
- [ ] How IBKR applies day-trade rules to a $1,000 to $2,000 Australian account. (Researched 18 Nov 2026, not settled: ask IBKR support.)
- [ ] Maximum loss per day, once real spread prices are known.
- [x] Exit rules for the first strategy: profit target, stop loss, time limit. (17 Nov 2026: two rules tested side by side, see Decisions.)
- [x] Where the bot runs: Ben's home PC first (18 Nov 2026), running IB Gateway and the bot through US market hours (Sydney night); a small cloud server later if the PC misses nights. Supabase alone can't host it: an individual IBKR account connects only through IB Gateway (OAuth web access is for organisations, advisers and brokers).

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

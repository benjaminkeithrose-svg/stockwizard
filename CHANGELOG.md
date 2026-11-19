# Changelog

What changed, newest first, by the date it was merged (Sydney time). Each line is one pull request
on GitHub (#number). Kept up when Ben asks for a documentation refresh.

## 19 November 2026

- #72 1-minute candles and charts; 15- and 30-minute charts built from the 5-minute candles (they were empty since the move to IBKR)
- #71 Same-day backtests on IBKR's hourly candles; the second entry moves from 10:30 to 10:00

- #70 One Update button (Menu, Updates and what's new) for the app and Stock Wizard on the PC; checked each time the app opens

- #69 The candle archive guards itself: a damaged archive is set aside and the backup put back; a damaged archive is never backed up

- #68 Fixed: taps on the chart did nothing on the phone (replay, levels, trendlines); the replay controls fit a phone

- #67 Bar replay: hide everything after a chosen day, step or play at up to 10×, practise trades scored at the replayed prices

- #66 Traditional patterns and linked symbols in the Lab: 18 candlestick and chart patterns, QQQ, IWM, NVIDIA, Apple and Tesla, and three questions (SPY up, SPY down, VIX spike)

- #65 The Lab: Ideas, Backtested and Paper trading in one place; a verdict and a progress line on every backtest; Start paper trading; Run backtests from the app on Ben's PC

- #64 Trading is the one place to approve, reject, close and switch strategies; Safety and limits keeps the kill switch and limits; Access key moves into Setup; Today's Waiting for you opens Trading

- #63 Ease of use, round 1: the menu in two columns, option backtests named in the header, no greyed-out Automate button, stale wording tidied

- #62 Stock Wizard's own icon on Windows (the phone's); What's new with Check for updates and Update; an Updated note after a new build

- #61 On the PC the menu drops down from its button, and symbol and help search open as panels; full screen stays on the phone

- #59 Setup inside the app: the installer asks nothing; connect the PC in one tap, check TWS, prices and alerts, a window per monitor

- #58 Trading: what's running, orders as a broker lists them (Working, Filled, Closed, Not traded), results over time; Auto markers on charts

- #57 Chart workspace: the open tab changes the symbol; chart pages select a card and one toolbar acts on it; the toolbar along the top, down the side, floating or hidden

- #56 (i) buttons beside settings and numbers: what each means, in plain words; one glossary for them and Help's Terms

- #55 Plain names: Stock Wizard (no "bot"), Access key, Automate this strategy, Automated strategies, trading and market data on the PC line
- #54 Help and the guides refreshed: Menu, the installed program, live bars, bot keys, backtests on the PC
- #53 Backtests on the PC from the 20-year archive (Run backtests on the icon); bad IBKR prices repaired as read; Yahoo removed
- #52 A clearer icon by the clock: an S in a circle, coloured by state

## 18 November 2026

- #51 Getting around and dark mode, from Financial Vault: the full-screen menu, the path bar, one header everywhere
- #50 Stock Wizard updates itself from the icon by the clock (checked against GitHub's fingerprint)
- #49 Your PC runs the installed program: settings, archive and logs in AppData, the key encrypted by Windows
- #48 The app in its own window on the PC, the icon by the clock, and the Settings window
- #47 One program on the PC: it runs and restarts the bot and the market data; the PC status line in the app
- #46 Stock Wizard as a Windows installer, and the setup guide for invited people
- #45 Several people: shared market data, a bot key each, invitations; Claude for Ben only
- #44 Live bars on the charts in US hours, marked Live or Delayed
- #43 Real prices for chart orders; closes booked when they fill
- #42 Market data from Interactive Brokers, kept in an archive on the PC
- #41 The bot exits when TWS disconnects, so it reconnects cleanly
- #40 The bot can use delayed market data
- #39 The bot connects to TWS as well as IB Gateway; option chain fix
- #38 Help rebuilt as a guide (getting started, the bot and safety, troubleshooting, search); the user guide, how it runs, and this changelog
- #37 Bots made from backtests: Make a bot, only tested settings run, paper results against the backtest, bot trades on the chart
- #36 Indicators in one pop-up; the chip row keeps favourite structures, shared or per symbol
- #35 Monthly option backtests: credit and debit spreads, iron condors, call and put condors
- #34 Multi-day strategies for the bot (3 days, 9 days, about a month); US market holidays
- #33 Phone notifications through ntfy

## 17 November 2026

- #32 Today screen
- #31 0DTE research re-run with the $5,000 kitty
- #30 The $5,000 kitty on every backtest
- #29 Help in the menu
- #28 The 0DTE research in the app
- #27 The bot proposes trades from strategies you switch on
- #26 0DTE research framework (stage 2) and its first run
- #25 0DTE research report (stage 1)
- #24 Same-day option backtests; option time counted in trading hours
- #23 Backtests sized to the $50 limit; recording real option quotes
- #22 The Interactive Brokers connection (paper), ready to switch on
- #21 Backtests of iron condors and iron flies (modelled prices)
- #20 The pretend-broker bot every 10 minutes through US hours
- #19 Order a chart structure from its analysis; close paper positions
- #18 Option lines: an arrow on the line, details on touch
- #17 Options analysis and comparison (theoretical prices)
- #16 Where the bot runs: the home PC first
- #15 The paper bot runs against Supabase (pretend broker)
- #14 Changes made just before closing the app are kept
- #13 Indicator chips, calls and puts on the chart, safety rails, VIX filter
- #12 Phase 4: Claude in the app
- #11 Phase 3b: the pattern lab
- #10 Ideas: one-tap option structures on the chart
- #9 Phase 3: the backtester; chart cards stay where dropped
- #8 Chart pages and Get latest version
- #7 Phase 2: the scanner
- #6 Daily candle top-up and Supabase keepalive

## 16 November 2026

- #5 The web app published on GitHub Pages
- #4 Phase 1: the chart workspace
- #3 Phase 0: indicator library, data loader and Supabase tables
- #2 Build order, React and development data decisions
- #1 The spec, the proposal and the project instructions

# Ideas for later

Captured from Ben, not yet scheduled. Each goes into a phase when he picks it.

## Indicator chips on the chart (16 Nov 2026) — built 17 Nov 2026

- Every indicator on a chart shows as a chip (bubble) along the top of the
  chart, with an × to take it off straight away, no sheet to open.
- A favourites list of indicators sits at the side, so one tap puts a
  favourite on the current chart.
- Why: chips are faster than clicking through screens to find things.

## Validity check on test scenarios (17 Nov 2026)

- A validity check that runs each indicator, and combinations of
  indicators, through a set of test scenarios (made-up price paths such as
  a steady rally, a crash, sideways chop, a squeeze then a breakout) and
  confirms each behaves as expected.
- Today's tests already do this for single indicators with a few hand-made
  examples; this would make it a named, visible check covering combinations
  too.

## Chart pages (17 Nov 2026) — built 17 Nov 2026

- A page shows up to about 10 charts as large cards, dragged around and
  snapping together into a grid.
- A page's arrangement saves as a named view, to come back to for a quick
  scan of the charts.
- Each card is one of the workspace tabs (its symbol, timeframe,
  indicators and drawings). Tapping a card opens it full screen to view or
  change; changes apply to that tab everywhere.
- Phone: one card per row, scrolling down; tap for full screen.

## Tests described in plain language (17 Nov 2026)

- Describe a backtest, scan or indicator test in ordinary words (spoken or
  typed) and have it turned into the test's settings, rather than filling
  in fields.
- Overlaps phase 4: Claude built into the app can already create strategy,
  scan and indicator settings (SPEC.md, In-app Claude). This may come with
  it rather than as a separate feature.

## One-tap option structures on the chart (17 Nov 2026) — placing and dragging built 17 Nov 2026; feeding a backtest and an order still to come

For building positions, whether as an order to send to the broker or as a
backtest:

- Favourite structures as chips at the top (iron condor, butterfly, debit
  spreads and so on). One tap places the structure on the chart.
- It is placed by a best guess: centred on the day's mean price (or the
  mean for whatever period the chart shows), with a default wing width as a
  setting.
- Once placed, drag on the chart (mouse on the PC, touch on the phone) to
  shift the whole structure up or down, and to move each wing in or out on
  its own, because Ben sometimes trades uneven wings.
- The same placement should feed both a backtest and an order for approval
  (phase 5: orders only ever go out after Ben approves them, behind the
  safety rails).

## Positions on every chart, and an analysis screen (17 Nov 2026) — positions on every chart built 17 Nov 2026; the analysis screen and comparison built 18 Nov 2026 on theoretical prices, real quotes once IBKR is connected

Follows on from the one-tap option structures above.

- A position placed on a chart (an iron condor, say) shows on every chart
  of that ticker, across all tabs and chart pages, so a position is never
  out of sight. Backtesting screens are the exception: they keep their own.
- Positions are tappable, and marked as planned (not yet bought) or
  bought: planned in purple, bought in green, with a way to say "yes,
  bought" or "no".
- Tapping a position opens an analysis screen: the usual option views (the
  profit and loss at expiry and today across prices, break-evens, the risk
  measures), for butterflies, iron condors and the rest. Built in Stock
  Wizard's own style; Ben is used to TradeStation's views, but the spec
  rules out copying another product's tools.
- Comparison is the main use: the same structure over different expiry
  dates (12 days against 9; 0DTE against 3 days), or a different structure
  altogether, to see which pays best for the trade.

## One installed program on the PC (18 Nov 2026)

- Package the PC side as an installed program, alongside the app and the
  web interface, so the bot, the data program and the Interactive Brokers
  connections live inside the project rather than as separate windows
  started by hand each time.
- Why: Ben doesn't want to start these things over and over. It should
  start with Windows, keep the bot and the data program running, restart
  them when TWS restarts, and show their state in one place.
- Shareable (Ben, 18 Nov 2026): packaged so that, shared later, it installs
  and runs on any Windows PC: its own Python inside, nothing else to
  install. Each person would still need their own Interactive Brokers
  account with TWS or IB Gateway, and their own Supabase project and keys
  (or the app made multi-user), set up on first run rather than by editing
  files.

## Menus, navigation and style from Finance Vault (18 Nov 2026)

- Take cues from Ben's Finance Vault (`benjaminkeithrose-svg/financevault`)
  for how he likes menus, navigating the app and its styles.
- Today Stock Wizard follows Field CRM's look (CLAUDE.md, Hard rules). Read
  Finance Vault first, list what it does differently, and agree with Ben
  which parts to bring over before changing anything.

## The lab: one place from idea to automation (19 Nov 2026)

- Backtests and the pattern lab become one screen, **the Lab**: find an idea,
  test it backwards (history) and forwards (paper, running live), then
  automate it to capture it from the market. All in one flow.
- Why: testing backwards and forwards happens at the same time; it should be
  one slick path, not separate screens.

## Traditional patterns as conditions (19 Nov 2026)

- Add the patterns earlier traders recognised, alongside our own searches:
  candlestick patterns (engulfing, hammer, doji, morning star, inside bar)
  and chart patterns (flags, pennants, triangles, double tops, head and
  shoulders, breakouts), plus the traditional indicators (RSI, momentum and
  the rest) and how they combine.
- Market internals as well: NYSE TICK (upticks minus downticks), advance and
  decline, TRIN.
- Each pattern detected only from what's known at the bar's close (a chart
  pattern counts only once it's confirmed), truncation-tested like every
  other rule, and usable as a condition in the lab.

## Patterns across linked symbols (19 Nov 2026)

- Pick a few symbols (say three) and look at how they move together:
  correlations, which one leads, and whether a pattern on one or two of them
  (a flag on two charts) says something about the third.
- Linked symbols for SPY: the VIX, and the big names that move it (NVIDIA,
  Apple, Tesla and so on).
- Needed to narrow the search: the combinations grow very fast, so the
  false-discovery check and the held-back years matter more.

## Test this structure, from the chart (19 Nov 2026)

- Put a structure on a chart (a debit butterfly on SPY, say) and ask: how
  often has this exact position, placed the same way, made money in the past?
  Optionally only on days like today across the linked symbols (VIX level,
  NVIDIA's trend and so on).
- The answer: the historical chance of profit, the average result, the worst
  case. Run on Ben's PC from the archive (not instant, but minutes), with the
  result shown on the structure's analysis.
- Why: a check before pressing the button, which may save money on trades
  that history says don't work.

## Chart workspace: one symbol control, one toolbar, movable (19 Nov 2026)

- The tab's name (IWM) and the symbol button under it are the same thing:
  make them one control, so changing symbol takes the fewest taps.
- On chart pages, tapping a chart selects it and the one toolbar acts on
  it (symbol, timeframe, indicators, options, draw), instead of a toolbar per
  chart.
- The toolbar can be hidden and moved: along the top, down the side, or
  floating in front of the charts where you drag it, remembered per device.
- Why: fewer taps, and on wide or several screens the toolbar isn't
  stretched across all of them.

## Several screens, each with its own layout (19 Nov 2026)

- On the PC, Stock Wizard detects the monitors and opens a window on each,
  with its own job: say the main working chart on the left, a page of the
  symbols you watch in the middle, and automated trading on the right.
- Configurable per person, with a setup step for it; charts don't jump
  between screens.

## Trading screens (19 Nov 2026)

- A trading screen showing what's running in the market (automated
  strategies, open positions), that can sit on its own screen next to the
  charts.
- A marker on each chart tab or card where an automated strategy trades
  that symbol, so it's always clear where orders are being placed.
- Orders, like TradeStation or tastytrade: working orders with their
  current value, filled orders with fill price and time, closed positions.
- Results: profit and loss over time against targets and limits, by
  strategy, and against what its backtest expected.
- All in one Trading group in the menu.

## A joint account, two people (19 Nov 2026)

- Ben may open a joint account at Interactive Brokers (to check: whether a
  joint account comes with its own paper account).
- Two people working the same account, each with full say: the same
  automated strategies, orders, limits and results, but their own chart
  layouts and screens (each on their own install).
- How it would fit: today orders, strategies and limits belong to one
  person. They'd belong to a shared trading account instead, with its
  members listed; chart tabs, pages and favourites stay per person. Only one
  PC may trade the account (one TWS login), so the other install shows and
  approves but doesn't trade.

## Bar replay (19 Nov 2026) — built 19 Nov 2026

- Like TradingView's bar replay: pick a day on the chart, everything after it
  is hidden, then step forward one candle at a time (or play at a chosen
  speed) and practise reading the chart and placing trades as if it were
  live.
- Indicators only see the candles shown so far (they're causal and
  truncation-tested already, so nothing peeks ahead).
- Practice trades during a replay are scored at the replayed prices, kept
  apart from paper trading.

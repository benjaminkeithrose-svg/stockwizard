# Ideas for later

Captured from Ben, not yet scheduled. Each goes into a phase when he picks it.

## Indicator chips on the chart (16 Nov 2026)

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

## One-tap option structures on the chart (17 Nov 2026)

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

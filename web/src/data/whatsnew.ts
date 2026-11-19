// What's new (Menu, What's new; Ben, 19 Nov 2026): what changed, in plain English, newest
// first. Add an entry with each change people would notice, under the build that brings it
// (APP_BUILD in config.ts). The app says "Updated" once after a new build loads.

export interface News { build: string; date: string; items: string[] }

export const WHATS_NEW: News[] = [
  { build: "sw-v53", date: "19 Nov 2026", items: [
    "Help mentions the 1-minute timeframe. The user guides are refreshed for everything up to the joint account.",
  ] },
  { build: "sw-v52", date: "19 Nov 2026", items: [
    "Joint account: Menu, Joint account shares your trading account with someone you've invited. Both of you get full say on its orders, limits and automated strategies, each on your own install, with your own charts.",
    "Only the owner's PC trades it; the partner's Stock Wizard shows and approves. Every approval, close and change says who did it.",
  ] },
  { build: "sw-v51", date: "19 Nov 2026", items: [
    "Claude can now read 1-minute candles, and 15- and 30-minute candles again (built from the 5-minute ones, the same way the chart builds them).",
  ] },
  { build: "sw-v50", date: "19 Nov 2026", items: [
    "Test a structure against the past: tap a structure's chip, then History, Test it against the past. It shows how often the same shape, placed the same way and held to expiry, made money on every past day, with the average, the middle, the worst and the best.",
    "Only days like today: chips keep just the days when the VIX was near today's, or when SPY, QQQ, NVIDIA and the rest were trending the same way as now.",
  ] },
  { build: "sw-v49", date: "19 Nov 2026", items: [
    "Pattern markers: in Indicators, pick candlestick and chart patterns to mark on the chart, green below for bullish, red above for bearish, on the candle where each became complete.",
    "They're found exactly the way the Lab finds them (checked pattern by pattern), so what you see on the chart is what the Lab tests.",
  ] },
  { build: "sw-v48", date: "19 Nov 2026", items: [
    "1-minute charts: pick 1m beside 5m. A week of 1-minute candles, filled in by Stock Wizard on Ben's PC after its next update, plus today's live minutes.",
    "Fixed: 15- and 30-minute charts were empty since the move to Interactive Brokers. They're now built from the 5-minute candles.",
  ] },
  { build: "sw-v47", date: "19 Nov 2026", items: [
    "One Update button: Menu, Updates and what's new. It updates whatever is behind, the app and (on the PC) Stock Wizard itself, so there's no second path to remember.",
    "Each time the app opens it checks, and a note at the top says when an update is ready.",
  ] },
  { build: "sw-v46", date: "19 Nov 2026", items: [
    "Fixed: on the phone, tapping the chart to start a replay (or to place a level or trendline) did nothing. A quick tap now counts.",
    "On the phone, the replay controls are one strip across the top of the chart (swipe it sideways for Buy, Sell and Exit), so the chart stays visible.",
  ] },
  { build: "sw-v45", date: "19 Nov 2026", items: [
    "Bar replay: Replay on the chart's toolbar, tap a day, and everything after it is hidden. Step a candle at a time or play at up to 10×.",
    "Practise trading in a replay with Buy, Sell and Close, scored at the replayed prices. Practice trades are never paper orders.",
  ] },
  { build: "sw-v44", date: "19 Nov 2026", items: [
    "The pattern lab looks for traditional patterns: candlesticks (engulfing, hammers, stars, doji and more) and chart patterns (flags, double tops and bottoms, triangles, breakouts), each counted only once it's confirmed.",
    "It also looks at QQQ, IWM, NVIDIA, Apple and Tesla: their moves and patterns, and how they move with SPY.",
    "Three questions in the Lab's Ideas: SPY up 2%, SPY down 2%, and a VIX spike. Pick one with the buttons at the top.",
  ] },
  { build: "sw-v43", date: "19 Nov 2026", items: [
    "The Lab (Menu, Lab) replaces Backtests: one place from an idea to a strategy trading on paper, in three tabs: Ideas, Backtested and Paper trading.",
    "Every backtest has a plain verdict from its held-back years: Held up, Didn't hold up, Too few to tell or Burned, and a line showing how far it has come.",
    "Start paper trading (was Automate this strategy) on a backtest that held up.",
    "On Ben's PC, Run backtests on this PC at the top of the Lab.",
  ] },
  { build: "sw-v42", date: "19 Nov 2026", items: [
    "Trading is the one place for trading: approve or reject waiting orders, close open positions, and switch automated strategies on and off, all under Trading, Now.",
    "Safety and orders is now Safety and limits: the kill switch and your limits.",
    "On Today, tap Waiting for you to open Trading.",
    "Access key has moved into Setup (Connect this PC makes it for you).",
    "Setting up an automated strategy by hand is in its ⋯ menu.",
  ] },
  { build: "sw-v41", date: "19 Nov 2026", items: [
    "The menu sits in two columns, so it fits a phone screen without scrolling.",
    "An option backtest's page shows its name in the header.",
    "A strategy that can't be automated says why, instead of showing a greyed-out button.",
    "Tidied wording left over from the free data source and the word \"bot\".",
  ] },
  { build: "sw-v40", date: "19 Nov 2026", items: [
    "Stock Wizard on the PC has its own icon, the same as the phone's, in the Start menu, the taskbar and the installer.",
    "What's new (this screen). On the PC it also shows Stock Wizard's version, checks for an update each time it opens, and updates with one press.",
    "After an update, a note at the top says so, with a link here.",
  ] },
  { build: "sw-v39", date: "19 Nov 2026", items: [
    "On the PC, the menu drops down from its button, and symbol and help search open as panels. The phone keeps them full screen.",
  ] },
  { build: "sw-v38", date: "19 Nov 2026", items: [
    "Setup (Menu, Setup): connect a PC in one tap, check TWS, choose prices and phone alerts, and give each monitor a job. The installer asks nothing now.",
  ] },
  { build: "sw-v37", date: "19 Nov 2026", items: [
    "Trading (Menu, Trading): what's running, orders as a broker lists them (Working, Filled, Closed, Not traded), and results over time.",
    "An Auto tag on charts where automated trading touches that symbol.",
  ] },
  { build: "sw-v35", date: "19 Nov 2026", items: [
    "Tap the open tab to change its symbol.",
    "On chart pages, tap a chart to select it: the one toolbar at the top changes it.",
    "The toolbar can sit along the top, down the side, float where you drag it, or hide (the ⋮⋮ grip).",
  ] },
  { build: "sw-v34", date: "19 Nov 2026", items: ["(i) buttons beside settings and numbers explain what each means."] },
  { build: "sw-v33", date: "19 Nov 2026", items: ["Plain names: Stock Wizard (no \"bot\"), Access key, Automate this strategy, Automated strategies."] },
  { build: "sw-v31", date: "19 Nov 2026", items: ["Backtests run on Ben's PC from 20 years of history; the free Yahoo data is gone."] },
];

export const SEEN_BUILD = "stockwizard.seenBuild";

/** Whether to say "Updated" this time: a build has been seen before on this device and it isn't this one. */
export function justUpdated(seen: string | null, current: string): boolean {
  return !!seen && seen !== current;
}

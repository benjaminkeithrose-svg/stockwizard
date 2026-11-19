// What's new (Menu, What's new; Ben, 19 Nov 2026): what changed, in plain English, newest
// first. Add an entry with each change people would notice, under the build that brings it
// (APP_BUILD in config.ts). The app says "Updated" once after a new build loads.

export interface News { build: string; date: string; items: string[] }

export const WHATS_NEW: News[] = [
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

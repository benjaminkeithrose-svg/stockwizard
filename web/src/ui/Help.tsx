// Help (Menu): a guide in plain English. Getting started first, then each
// screen, automated trading and its safety, what to do when something looks wrong, and
// the terms. Each topic is folded so the page stays short; the search icon
// opens a full-screen search over every topic. Refreshed 19 Nov 2026: Ben
// asks for a refresh when he wants one (it isn't redone with every change).

import { useState } from "react";
import { GLOSSARY, Term } from "../data/glossary";
import { Search } from "./icons";
import { Sheet } from "./parts";

type Topic = [string, string[]];

const START: Topic[] = [
  ["1. Sign in and get the latest version", [
    "Sign in with your email and password. Everything you set up is saved to your account and follows you between the phone and the PC.",
    "Menu (top right), then Updates and what's new: one Update button brings everything up to date. The app also checks each time it opens and says when an update is ready. The build number is at the bottom of the menu. Menu → Light or dark switches the look.",
  ]],
  ["2. Set up a chart", [
    "Tap the open tab (it has a ▾) to change its symbol; the joined buttons pick the timeframe (1m to 1d; a week of 1-minute candles).",
    "Indicators adds moving averages, Bollinger bands, the squeeze, RSI and the rest. Star the ones you use: they wait under Favourites for one tap next time.",
    "The + at the end of the tabs adds another chart. Chart pages (the grid icon) shows several at once.",
  ]],
  ["3. Look at a trade before making it", [
    "Options places a structure (an iron condor, a credit spread…) around the current price. Drag its lines to move the strikes.",
    "Tap its chip above the chart for the analysis: profit or loss at every price, time decay, the Greeks and the chance of profit. All theoretical prices for now.",
  ]],
  ["4. Check what the history says", [
    "The Lab (in the menu) shows how rules and option structures did over about 20 years, each with a verdict from the held-back years: the years it never saw while it was being made.",
    "Each test also shows what $5,000 would have become, risking 2% a trade.",
  ]],
  ["5. Automate a strategy and let it trade on paper", [
    "On an option backtest that held up, or a 0DTE survivor, tap Start paper trading, then Done. It's saved switched off; switch it on in the Lab's Paper trading tab or in Trading.",
    "Set your limits first: Menu, Safety and limits, then tap the Limits card. With no daily loss limit, every order is refused.",
    "Switch it on under Automated strategies (Menu, Trading). At its entry time each trading day it proposes the trade; you approve it in Trading (or let it run in Automatic mode, paper only). Your phone tells you when there's something to do.",
  ]],
  ["6. Each morning", [
    "Today (top of the chart screen) shows whether the US market is open, the market numbers, what each automated strategy did, and today's result against your limit.",
  ]],
];

const SCREENS: Topic[] = [
  ["The chart", [
    "Tabs along the top: each is a symbol and timeframe you've set up. The + adds one; ⋯ on a tab renames, duplicates or deletes it.",
    "In US market hours the chart adds today's bars every 5 seconds. Live means real-time prices; Delayed means about 15 minutes late (no market data subscription).",
    "Indicators (with how many are on the chart) opens the list: tap one for its settings, the bin takes it off, the star keeps it as a favourite. Favourites sit under that list for one-tap adding, and the full list is below.",
    "Under the toolbar: the option structures on this chart, then your favourite structures (starred ones on every chart, and this symbol's own) to place in one tap. Draw adds levels and trendlines.",
    "Options places a call, put, spread, condor or fly. It goes one daily range out by default, with $5 wings. Its star makes a structure a favourite on every chart; the symbol button beside it, on this symbol only.",
  ]],
  ["Pattern markers", [
    "Indicators, then Patterns on the chart: pick candlestick patterns (engulfing, hammer, stars, three soldiers or crows…) and chart patterns (flags, double tops and bottoms, triangles, 20-day breakouts). \"all\" switches on a whole group (leaving out doji and inside bars, which are very common).",
    "Each mark sits on the candle where the pattern became complete: a green arrow below for bullish, a red arrow above for bearish. They're found the same way the Lab finds them, and only from candles up to that one. Kept on this device, for every chart.",
  ]],
  ["Bar replay", [
    "Replay (on the chart's toolbar), then tap the candle to start from: everything after it is hidden. Step a candle at a time (‹ ›) or press play at 1×, 2×, 5× or 10×.",
    "Practise as if it were live: Buy or Sell at the latest close showing, then Close. Each practice trade is scored at the replayed prices and summed up in the bar. They're never paper orders, and they're gone when you exit.",
    "The indicators only see the candles showing, so nothing peeks ahead. Exit returns to today.",
  ]],
  ["Options on the chart", [
    "Each leg is a line: ▲ for a call, ▼ for a put. Solid lines are legs you sell; dotted lines are legs you buy. Purple means planned; green means marked bought.",
    "Touch a line to see that leg, its expiry and days left.",
    "Teal lines are an automated strategy's open paper position. An arrow (Auto in) marks where its trade opened; a dot with its profit or loss, where it closed.",
    "Tap the structure's chip to open its analysis. Adjust on the chart lets you drag it: All moves everything, Side moves the put or call side, Leg moves one line.",
  ]],
  ["Analysis", [
    "The graph shows profit or loss at every price: the solid line at expiry, the dashed line at the date on the slider. Green is profit; red is loss. The shaded band is the expected move.",
    "Move the date slider to watch time decay, and the volatility slider to see what a calmer or wilder market does.",
    "+ Compare puts up to 3 structures on one graph, with a table side by side.",
    "History, Test it against the past: how often the same shape, placed the same way and held to expiry, made money on every past day in the daily candles, with the average, worst and best. Chips keep only days like today (the VIX near today's, or SPY, QQQ, NVIDIA and others trending the same way). A rough check on modelled prices, not a tested strategy.",
    "Send as a paper order passes it to Stock Wizard on your PC. It prices it, checks every limit, and it waits for you in Trading. Sent while the US market is shut, it waits for the next open (9:35 am New York) and goes then.",
    "Your PC works the price for you: it starts at the midpoint, moves a little each half minute towards the worst price allowed (the midpoint less 10% of the spread's width), and cancels it if it hasn't filled after 55 minutes (10:30 am New York for an order sent overnight). Automated strategies' entries are worked the same way.",
    "All prices here are theoretical (Black-Scholes) until Interactive Brokers supplies real ones.",
  ]],
  ["Joint account", [
    "Menu, Joint account: share your trading account with someone already invited to Stock Wizard, by their sign-in email. Both of you then have full say on it: orders, approvals, closes, the kill switch, the limits and the automated strategies.",
    "Only the owner's PC trades it (one TWS login). Stock Wizard on the partner's PC shows and approves but doesn't trade. Charts, pages and favourites stay each person's own.",
    "Either of you can end it: Stop sharing, or Leave this account. Nothing is deleted.",
  ]],
  ["Trading", [
    "Menu, Trading. Now: the automated strategies switched on, orders waiting for you, and open positions with their value now (a theoretical estimate).",
    "Orders, as a broker lists them: Working (waiting, approved, at the broker, or being closed), Filled (open), Closed (with profit or loss) and Not traded (refused, rejected, cancelled). Tap one for its legs, prices and times.",
    "Results: the total, share won, average win and loss, today against the daily limit, the running total over time, and each strategy's results.",
    "An Auto marker on a chart tab or page card means automated trading touches that symbol: a strategy switched on for it, or a position open.",
  ]],
  ["Today", [
    "The morning checklist: whether the US market is open and when it opens in Sydney time, the latest SPY price, VIX, VIX1D, expected move to the close, opening range, VWAP and direction.",
    "Under it, each automated strategy that's switched on and what it did today, the orders waiting for you, today's profit or loss and how much of the daily limit is used. A Fed day or an expiration Friday is flagged at the top.",
    "Your PC saves the market numbers every 30 seconds during the US session; between sessions you see the last session's.",
  ]],
  ["Chart pages", ["Up to 10 charts as cards on a page. Tap a card to select it (outlined): the toolbar at the top then changes that chart. The expand button on a card (or a double-click) opens it full screen. On the PC, drag a card's title to move it and its corner to resize it; Tidy closes the gaps."]],
  ["The toolbar", ["The grip at the toolbar's start (⋮⋮) puts it along the top, down the side, floating in front of the charts (drag it by ⠿), or hidden behind a Tools button. Remembered on each device."]],
  ["Scanner", ["The latest run of each scan, in tabs: squeeze on, squeeze fired, breakout, trend break, drawdown and RSI divergence. Scans run on Ben's PC after each US close (about 8 to 9 am Sydney). Tap a result to open it on the chart."]],
  ["The Lab", [
    "One place from an idea to a strategy trading on paper, in three tabs: Ideas (what the pattern lab and the 0DTE research found), Backtested (every tested strategy) and Paper trading (the ones running by themselves on paper, against what their backtest expected).",
    "Each backtest has a verdict from its held-back years: Held up (made money on average), Didn't hold up, Too few to tell (under 10 trades) or Burned (the held-back years were already seen). Under it, how far it has come: Idea, Backtested, Paper trading.",
    "While trading is paper-only, paper trading a strategy and automating it are the same thing: it runs by itself at Interactive Brokers with practice money.",
    "Stock signals: each stock rule's build years (2006–2021) and held-back years (the last 5) side by side. Only the held-back column stands for what to expect.",
    "Backtests run on Ben's PC from its 20-year candle archive (Run backtests on this PC at the top of the Lab, or on the icon by the clock). Runs that use Yahoo's old candles for the early years say so and carry the free-data warning.",
    "Option structures: on SPY with modelled prices. The chips at the top pick a group: condors and flies, $1 wings, 0DTE methods, and monthly (credit and debit spreads, iron condors, call and put condors, each managed one way: held to expiry, take 50%, close at 21 days left, or a stop at twice the credit).",
    "0DTE research (Ideas): the same-day research. It shows how many strategies were tried, how many survived the false-discovery check, and whether they held up on data they weren't chosen on. Tap a dot or a card for the detail.",
    "Pattern lab (Ideas): what came before three things: SPY rising 2% within 5 days, SPY falling 2%, and a VIX spike. It searches SPY's own measures, traditional candlestick and chart patterns (engulfing, hammers, stars, flags, double tops and bottoms, triangles, breakouts), the VIX, and the linked symbols (QQQ, IWM, NVIDIA, Apple, Tesla): their moves, trends and patterns, and how they move with SPY. Every pattern is counted and checked against luck; more patterns tried means a higher bar.",
    "Each backtest also shows what $5,000 would have become, with every trade risking 2% of the balance. Trades too big for 2% at one contract are skipped and counted.",
  ]],
  ["Watchlists", ["Lists of symbols (Menu, Watchlists). Tap a list, then a symbol, to open it on the chart."]],
  ["Getting around", ["Menu (top right) lists every screen. The path under the header shows where you are: tap any step to go back to it. The back arrow goes up one level; the house goes to the chart."]],
  ["Claude", ["The spark icon. Ask in plain words: run a test, explain a result, put an indicator on the chart. Claude can't place orders or change limits, and everything it does is recorded. Up to 100 questions a day."]],
];

const BOT: Topic[] = [
  ["Automate a strategy", [
    "At the top of each option backtest page and in each 0DTE survivor. It fills in the automated strategy with exactly the tested settings: structure, expiry, strikes, wings, how it's managed, and any VIX filter or signal. Its card shows the held-back result.",
    "Only tested settings can run. Change a setting and it's marked Untested and switched off; Put them back restores them. One set up by hand is untested.",
    "Can't be automated yet, and say why: stock strategies and the pattern lab (stock signals; automated trading places options), the same-day methods tested on hourly candles, and call or put condors.",
  ]],
  ["What an automated strategy does each day", [
    "In the 15 minutes after its entry time (New York) it reads the market, checks its setup (VIX range, signal, direction), picks the strikes and proposes the trade at the price you can count on getting.",
    "Every order then goes through the safety rails. In Approve mode it waits for you; in Automatic mode (paper only) it's sent straight away if every rail passes.",
    "While a trade is open, your PC checks its exits every 30 seconds: profit target, stop, days left, time of day. Anything still open settles at its expiry's close.",
    "Same-day strategies trade once a day. Multi-day ones (3 days, 9 days, about a month) hold one position at a time, overnight.",
    "A day with no setup is recorded with the reason; Today shows it.",
  ]],
  ["The safety rails", [
    "Every order must pass all of them, when proposed and again when approved: defined risk only (no naked options), the most a trade may lose, the most a day may lose, positions open at once, capital at risk, prices no older than your limit, limit orders only, and the kill switch off.",
    "While the daily loss limit is empty, every order is refused.",
    "The kill switch (Menu, Safety and limits) stops all trading at once: it drops waiting orders and cancels anything working.",
    "Paper trading only. Live trading can't be turned on from the app, and Stock Wizard refuses live ports and accounts.",
  ]],
  ["Approving, closing and switching on (Trading)", [
    "Trading, Now: Waiting for you lists orders proposed by an automated strategy or sent from a chart. Tap one to approve or reject it. Approving doesn't send it straight away: your PC gets a fresh price and checks every limit again first.",
    "Tap an open position to close it.",
    "Automated strategies: switch one on (it asks first) or off. Each card shows Tested or Untested, its paper results so far, and what its backtest expected. Its ⋯ sets one up by hand (untested).",
  ]],
  ["Safety and limits", [
    "The kill switch, and the limits: the most a trade or a day may lose, positions at once, capital at risk, how old prices may be, and Approve or Automatic.",
  ]],
  ["Phone notifications", ["Through the free ntfy app: an order waiting for you, filled, closed or stopped, and the daily loss limit reached. Each is told once. Open Stock Wizard's Trading to act on it."]],
  ["Where trading runs", [
    "In the Stock Wizard program on your Windows PC, next to Interactive Brokers' TWS logged in to Paper Trading. It runs behind the icon by the clock (an S in a circle: green connected, amber waiting, red stopped) and starts when you sign in to Windows.",
    "The line under the header (PC: …) shows whether the PC's trading connection and market data are running, from its heartbeat every 30 seconds.",
    "Right-click the icon for Settings, Logs, updates and, on Ben's PC, Run backtests. Closing the window keeps trading running; Quit on the icon stops it.",
    "Setting up a PC: docs/SETUP.md on GitHub, or the setup guide in the Start menu.",
  ]],
  ["Updates and what's new", [
    "Menu, Updates and what's new: one Update button at the top updates whatever is behind (the app, and on the PC, Stock Wizard itself), then what changed lately, in plain words. After an update a note at the top says so.",
    "Why two pieces: the screens load from the web (updated in seconds), while the program on the PC (trading, market data, backtests) is installed and needs its installer. The one button does whichever is needed, or both.",
    "On the PC it also shows Stock Wizard's version, checks for an update each time it opens, and Update installs it with one press (after the US close, so trading isn't cut off). In a browser or on the phone, Get latest version reloads the newest app.",
  ]],
  ["Setup (on the PC)", [
    "Menu, Setup: connect this PC (one tap makes and saves its access key), turn on TWS's connection and check it, real-time or delayed prices, phone notifications, and what each monitor shows.",
    "It opens by itself the first time Stock Wizard on a PC has nothing set up. Every step can be skipped and done later.",
  ]],
  ["Access key (invited people)", ["The key your PC's Stock Wizard signs in with. Menu, Setup, Connect this PC makes and saves it in one tap (on an older set-up, Setup links to making one by hand). It can only touch your own orders. Making a new one stops the old one."]],
];

const TROUBLE: Topic[] = [
  ["The app looks out of date", ["Menu, Updates and what's new, then Update. If it says up to date but still looks old, close the app fully and open it again."]],
  ["Today says no snapshot, or the numbers are old", ["Your PC saves them only during the US session. If the session is open and they're more than 10 minutes old, Stock Wizard isn't running on the PC: look at the PC line under the header, then the icon by the clock on the PC."]],
  ["The PC line says waiting or stopped", ["Usually TWS: it isn't open, isn't logged in to Paper Trading, or restarted overnight. Log in again; Stock Wizard reconnects within a minute. Right-click the icon by the clock, Logs, shows the full story."]],
  ["An automated strategy didn't propose anything", ["Open Today: it shows the reason (outside its VIX range, no setup, a day it skips, a position still open). If it says your PC may not have been running, Stock Wizard wasn't running at the entry time."]],
  ["Every order is refused", ["Open the order in Trading (Orders, Not traded): it lists every rail it failed. Most often the daily loss limit is empty, the trade risks more than the per-trade limit, or the prices are too old."]],
  ["Charts have no candles, or yesterday is missing", ["Candles come from Interactive Brokers through Ben's PC, topped up after each US close (about 8 to 9 am Sydney). While that PC or TWS is off nothing updates; the next start fills the gap. A new symbol needs adding to the symbol list; ask me."]],
];

const TERMS: [string, string][] = Object.values(GLOSSARY as Record<string, Term>).filter((t) => t.help).map((t) => [t.title, t.text]);

const SECTIONS: [string, Topic[]][] = [
  ["Getting started", START],
  ["The screens", SCREENS],
  ["Automated trading and safety", BOT],
  ["When something looks wrong", TROUBLE],
  ["Terms", TERMS.map(([t, w]) => [t, [w]] as Topic)],
];

function TopicCard({ topic, open }: { topic: Topic; open?: boolean }) {
  const [title, lines] = topic;
  return (
    <details className="helpitem" open={open}>
      <summary>{title}</summary>
      {lines.length === 1 ? <p>{lines[0]}</p> : <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
    </details>
  );
}

function HelpSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? SECTIONS.flatMap(([, topics]) => topics).filter(([t, lines]) => words.every((w) => (t + " " + lines.join(" ")).toLowerCase().includes(w)))
    : [];
  return (
    <Sheet title="Search help" full onClose={onClose}>
      <input autoFocus placeholder="e.g. kill switch, delta, refused" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help" />
      {words.length > 0 && !hits.length && <p className="empty">Nothing matches.</p>}
      <div style={{ marginTop: 10 }}>{hits.map((t) => <TopicCard key={t[0]} topic={t} open />)}</div>
    </Sheet>
  );
}

export default function HelpScreen() {
  const [searching, setSearching] = useState(false);
  return (
    <div className="list help">
      <button className="ghost" onClick={() => setSearching(true)} aria-label="Search help"><Search /> Search help</button>
      {SECTIONS.map(([name, topics]) => (
        <section key={name}>
          <h2>{name}</h2>
          {topics.map((t) => <TopicCard key={t[0]} topic={t} />)}
        </section>
      ))}
      <p className="hint">A fuller guide, how everything runs, and setting up a PC: docs/GUIDE.md, docs/OPERATIONS.md and docs/SETUP.md in the repository on GitHub.</p>
      {searching && <HelpSearch onClose={() => setSearching(false)} />}
    </div>
  );
}

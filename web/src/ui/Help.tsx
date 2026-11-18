// Help (Menu): a guide in plain English. Getting started first, then each
// screen, the bot and its safety, what to do when something looks wrong, and
// the terms. Each topic is folded so the page stays short; the search icon
// opens a full-screen search over every topic. Refreshed 19 Nov 2026: Ben
// asks for a refresh when he wants one (it isn't redone with every change).

import { useState } from "react";
import { Search } from "./icons";
import { Sheet } from "./parts";

type Topic = [string, string[]];

const START: Topic[] = [
  ["1. Sign in and get the latest version", [
    "Sign in with your email and password. Everything you set up is saved to your account and follows you between the phone and the PC.",
    "Menu (top right), then Get latest version, reloads the newest build. Do it after each change I tell you about. The build number is at the bottom of the menu. Menu → Light or dark switches the look.",
  ]],
  ["2. Set up a chart", [
    "The symbol button (top left of the toolbar) picks the symbol; the joined buttons pick the timeframe (5m to 1d).",
    "Indicators adds moving averages, Bollinger bands, the squeeze, RSI and the rest. Star the ones you use: they wait under Favourites for one tap next time.",
    "The + at the end of the tabs adds another chart. Chart pages (the grid icon) shows several at once.",
  ]],
  ["3. Look at a trade before making it", [
    "Options places a structure (an iron condor, a credit spread…) around the current price. Drag its lines to move the strikes.",
    "Tap its chip above the chart for the analysis: profit or loss at every price, time decay, the Greeks and the chance of profit. All theoretical prices for now.",
  ]],
  ["4. Check what the history says", [
    "Backtests (in the menu) shows how rules and option structures did over about 20 years. Read the held-back column: the years the rule never saw while it was being made.",
    "Each test also shows what $5,000 would have become, risking 2% a trade.",
  ]],
  ["5. Make a bot and let it trade on paper", [
    "On an option backtest or a 0DTE survivor you like, tap Make a bot, then Done. It's saved switched off.",
    "Set your limits first: Menu, Safety and orders, Change limits. With no daily loss limit, every order is refused.",
    "Switch the bot on under Bots. At its entry time each trading day it proposes the trade; you approve it in Safety and orders (or let it run in Automatic mode, paper only). Your phone tells you when there's something to do.",
  ]],
  ["6. Each morning", [
    "Today (top of the chart screen) shows whether the US market is open, the market numbers, what each bot did, and today's result against your limit.",
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
  ["Options on the chart", [
    "Each leg is a line: ▲ for a call, ▼ for a put. Solid lines are legs you sell; dotted lines are legs you buy. Purple means planned; green means marked bought.",
    "Touch a line to see that leg, its expiry and days left.",
    "Teal lines are a bot's open paper position. An arrow marks where a bot trade opened; a dot with its profit or loss, where it closed.",
    "Tap the structure's chip to open its analysis. Adjust on the chart lets you drag it: All moves everything, Side moves the put or call side, Leg moves one line.",
  ]],
  ["Analysis", [
    "The graph shows profit or loss at every price: the solid line at expiry, the dashed line at the date on the slider. Green is profit; red is loss. The shaded band is the expected move.",
    "Move the date slider to watch time decay, and the volatility slider to see what a calmer or wilder market does.",
    "+ Compare puts up to 3 structures on one graph, with a table side by side.",
    "Order (paper) sends it to the bot. The bot prices it, checks every limit, and it waits for you in Safety and orders.",
    "All prices here are theoretical (Black-Scholes) until Interactive Brokers supplies real ones.",
  ]],
  ["Today", [
    "The morning checklist: whether the US market is open and when it opens in Sydney time, the latest SPY price, VIX, VIX1D, expected move to the close, opening range, VWAP and direction.",
    "Under it, each bot that's switched on and what it did today, the orders waiting for you, today's profit or loss and how much of the daily limit is used. A Fed day or an expiration Friday is flagged at the top.",
    "The bot saves the market numbers every cycle during the US session; between sessions you see the last session's.",
  ]],
  ["Chart pages", ["Up to 10 charts as cards on a page. On the PC, drag a card to move it and its corner to resize it; Tidy closes the gaps. Tap a card to open it full screen."]],
  ["Scanner", ["The latest run of each scan, in tabs: squeeze on, squeeze fired, breakout, trend break, drawdown and RSI divergence. Scans run on Ben's PC after each US close (about 8 to 9 am Sydney). Tap a result to open it on the chart."]],
  ["Backtests", [
    "Strategies: each stock rule's build years (2006–2021) and held-back years (the last 5) side by side. Only the held-back column stands for what to expect.",
    "Backtests run on Ben's PC from its 20-year candle archive (Run backtests, on the icon by the clock). Runs that use Yahoo's old candles for the early years say so and carry the free-data warning.",
    "Options: option structures on SPY with modelled prices. The chips at the top pick a group: condors and flies, $1 wings, 0DTE methods, and monthly (credit and debit spreads, iron condors, call and put condors, each managed one way: held to expiry, take 50%, close at 21 days left, or a stop at twice the credit).",
    "0DTE: the same-day research. It shows how many strategies were tried, how many survived the false-discovery check, and whether they held up on data they weren't chosen on. Tap a dot or a card for the detail.",
    "Pattern lab: conditions that came before VIX spikes, every pattern counted and checked against luck.",
    "Each backtest also shows what $5,000 would have become, with every trade risking 2% of the balance. Trades too big for 2% at one contract are skipped and counted.",
  ]],
  ["Watchlists", ["Lists of symbols (Menu, Watchlists). Tap a list, then a symbol, to open it on the chart."]],
  ["Getting around", ["Menu (top right) lists every screen. The path under the header shows where you are: tap any step to go back to it. The back arrow goes up one level; the house goes to the chart."]],
  ["Claude", ["The spark icon. Ask in plain words: run a test, explain a result, put an indicator on the chart. Claude can't place orders or change limits, and everything it does is recorded. Up to 100 questions a day."]],
];

const BOT: Topic[] = [
  ["Make a bot", [
    "At the top of each option backtest page and in each 0DTE survivor. It fills in the bot with exactly the tested settings: structure, expiry, strikes, wings, how it's managed, and any VIX filter or signal. Its card shows the held-back result.",
    "Only tested settings can run. Change a setting and the bot is marked Untested and switched off; Put them back restores them. A bot set up by hand is untested.",
    "Can't be bots yet, and say why: stock strategies and the pattern lab (stock signals; the bot trades options), the same-day methods tested on hourly candles, and call or put condors.",
  ]],
  ["What a bot does each day", [
    "In the 15 minutes after its entry time (New York) it reads the market, checks its setup (VIX range, signal, direction), picks the strikes and proposes the trade at the price you can count on getting.",
    "Every order then goes through the safety rails. In Approve mode it waits for you; in Automatic mode (paper only) it's sent straight away if every rail passes.",
    "While a trade is open, the bot checks its exits every cycle: profit target, stop, days left, time of day. Anything still open settles at its expiry's close.",
    "Same-day bots trade once a day. Multi-day bots (3 days, 9 days, about a month) hold one position at a time, overnight.",
    "A day with no setup is recorded with the reason; Today shows it.",
  ]],
  ["The safety rails", [
    "Every order must pass all of them, when proposed and again when approved: defined risk only (no naked options), the most a trade may lose, the most a day may lose, positions open at once, capital at risk, prices no older than your limit, limit orders only, and the kill switch off.",
    "While the daily loss limit is empty, every order is refused.",
    "The kill switch (Safety and orders) stops all trading at once: it drops waiting orders and the bot cancels anything working.",
    "Paper trading only. Live trading can't be turned on from the app, and the bot refuses live ports and accounts.",
  ]],
  ["Safety and orders", [
    "Waiting: orders the bot has proposed. Tap one to approve or reject it. Approving doesn't send it straight away: the bot gets a fresh price and checks every limit again first.",
    "Bots: switch one on (it asks first) or off. Each card shows Tested or Untested, its paper results so far, and what its backtest expected.",
    "Limits: the most a trade or a day may lose, positions at once, capital at risk, how old prices may be, and Approve or Automatic.",
  ]],
  ["Phone notifications", ["Through the free ntfy app: an order waiting for you, filled, closed or stopped, and the daily loss limit reached. Each is told once. Open Stock Wizard's Safety and orders to act on it."]],
  ["Where the bot runs", [
    "In the Stock Wizard program on your Windows PC, next to Interactive Brokers' TWS logged in to Paper Trading. It runs behind the icon by the clock (an S in a circle: green connected, amber waiting, red stopped) and starts when you sign in to Windows.",
    "The line under the header (PC: …) shows whether the PC's bot and market data are running, from its heartbeat every 30 seconds.",
    "Right-click the icon for Settings, Logs, updates and, on Ben's PC, Run backtests. Closing the window keeps trading running; Quit on the icon stops it.",
    "Setting up a PC: docs/SETUP-BOT.md on GitHub, or the setup guide in the Start menu.",
  ]],
  ["Bot key (invited people)", ["Menu, Bot key, Make a bot key: the key your PC's Stock Wizard signs in with. It can only touch your own orders. Making a new one stops the old one."]],
];

const TROUBLE: Topic[] = [
  ["The app looks out of date", ["Menu, then Get latest version. If it still looks old, close the app fully and open it again."]],
  ["Today says no snapshot, or the numbers are old", ["The bot saves them only during the US session. If the session is open and they're more than 10 minutes old, the bot isn't running: look at the PC line under the header, then the icon by the clock on the PC."]],
  ["The PC line says waiting or stopped", ["Usually TWS: it isn't open, isn't logged in to Paper Trading, or restarted overnight. Log in again; Stock Wizard reconnects within a minute. Right-click the icon by the clock, Logs, shows the full story."]],
  ["A bot didn't propose anything", ["Open Today: it shows the reason (outside its VIX range, no setup, a day it skips, a position still open). If it says the bot may not have run in time, the bot wasn't running at the entry time."]],
  ["Every order is refused", ["Open the order in Safety and orders: it lists every rail it failed. Most often the daily loss limit is empty, the trade risks more than the per-trade limit, or the prices are too old."]],
  ["Charts have no candles, or yesterday is missing", ["Candles come from Interactive Brokers through Ben's PC, topped up after each US close (about 8 to 9 am Sydney). While that PC or TWS is off nothing updates; the next start fills the gap. A new symbol needs adding to the symbol list; ask me."]],
];

const TERMS: [string, string][] = [
  ["Call / put", "The right to buy (call) or sell (put) at a set price, the strike, until the expiry. One contract covers 100 shares."],
  ["Credit / debit", "A credit is money received to open a position (selling); a debit is money paid (buying)."],
  ["Spread", "Selling one option and buying another further out, so the most you can lose is capped: defined risk."],
  ["Bull put / bear call", "Credit spreads that profit if the price stays above (bull put) or below (bear call) a level."],
  ["Iron condor", "A bull put and a bear call together: profits if the price stays inside a range."],
  ["Debit spread", "Buying one option and selling another further out: you pay up front, and the most you can lose is what you paid. A bull call spread profits if the price rises; a bear put spread if it falls."],
  ["Call / put condor", "Four strikes all of one type, bought for a debit: profits if the price ends between the two middle strikes. The same shape as an iron condor, paid for up front instead of received."],
  ["Iron fly", "A condor with both short strikes at the current price. A bigger credit, but it needs the price to stay close."],
  ["Wing", "The option bought further out that caps the loss."],
  ["0DTE / DTE", "Days to expiry. 0DTE: opened and finished the same day."],
  ["Daily range (ATR)", "How far the price typically moves in a day, averaged over 14 days. Strikes placed 'one daily range out' sit that far from the price."],
  ["Delta", "How much the position gains or loses for a $1 move. A short strike's delta is roughly its chance of finishing in the money: 15 delta ≈ 15%."],
  ["Theta", "What time decay earns or costs each day."],
  ["Vega", "What a 1-point rise in volatility does to the position."],
  ["Expected move", "The range the market expects to about 2 chances in 3, worked out from option prices."],
  ["VIX / VIX1D", "The market's expected volatility: the VIX over 30 days, VIX1D over one day. Around 12–15 is calm; 25 and above is fear."],
  ["VWAP", "The day's average price weighted by volume. Above it and rising is bullish."],
  ["Opening range", "The high and low of the first 30 minutes."],
  ["Squeeze", "Bollinger bands inside the Keltner channel: the price is coiling. 'Fired' is when it breaks out of it."],
  ["Natural price", "Selling at the bid and buying at the ask, the price you can count on getting. The mid is halfway between."],
  ["Slippage", "Getting a worse price than expected, especially on fast moves."],
  ["Profit target / stop", "Close early when the trade has made a set share of the most it can make (take 50%), or lost a set amount (a stop at 2× the credit)."],
  ["Build years / held-back years", "Build years are where a rule was made. Held-back years are years it never saw while it was being made. Only results there stand for what to expect, and they can only be used once."],
  ["False-discovery check", "When hundreds of rules are tried, some look good by luck. This check (Benjamini-Hochberg) only passes those too strong to be luck."],
  ["Modelled prices", "Option prices worked out with Black-Scholes and the VIX, not real quotes. Real fills, especially on the wings, usually cost more."],
  ["The $5,000 kitty", "What $5,000 would have become, trade by trade, risking 2% of the balance on each."],
  ["Tested / untested bot", "A tested bot runs exactly the settings a backtest tested. Change any of them and it's untested until backtested again."],
  ["Kill switch", "Stops all trading at once: waiting orders dropped, working orders cancelled, nothing new until you turn trading back on."],
  ["Paper trading", "Practice orders with pretend money at Interactive Brokers. Nothing real is at stake."],
];

const SECTIONS: [string, Topic[]][] = [
  ["Getting started", START],
  ["The screens", SCREENS],
  ["The bot and safety", BOT],
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
      <p className="hint">A fuller guide, how everything runs, and setting up a PC: docs/GUIDE.md, docs/OPERATIONS.md and docs/SETUP-BOT.md in the repository on GitHub.</p>
      {searching && <HelpSearch onClose={() => setSearching(false)} />}
    </div>
  );
}

// Help (⋯ menu): each screen and the main terms, in plain English. Each topic
// is folded so the page stays short. Keep this in step with the app: a change
// to a screen changes its entry here in the same pull request.

const SCREENS: [string, string[]][] = [
  ["The chart", [
    "Tabs along the top: each is a symbol and timeframe you've set up. The + adds one; ⋯ on a tab renames, duplicates or deletes it.",
    "Under the toolbar, a chip for each indicator on the chart: tap it for its settings, × to take it off. The starred chips after it are your favourites: one tap adds them.",
    "Indicators adds more, and its star keeps one as a favourite. Draw adds levels and trendlines.",
    "Options places a call, put, spread, condor or fly. It goes one daily range out by default, with $5 wings.",
  ]],
  ["Options on the chart", [
    "Each leg is a line: ▲ for a call, ▼ for a put. Solid lines are legs you sell; dotted lines are legs you buy. Purple means planned; green means marked bought.",
    "Touch a line to see that leg, its expiry and days left.",
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
    "Today (top of the chart screen) is the morning checklist: whether the US market is open and when it opens in Sydney time, the latest SPY price, VIX, VIX1D, expected move to the close, opening range, VWAP and direction.",
    "Under it, each strategy that's switched on and what it did today, the orders waiting for you, today's profit or loss and how much of the daily limit is used.",
    "The bot saves the market numbers every cycle during the US session; between sessions you see the last session's.",
  ]],
  ["Chart pages", ["Up to 10 charts as cards on a page. On the PC, drag a card to move it and its corner to resize it; Tidy closes the gaps. Tap a card to open it full screen."]],
  ["Scanner", ["The latest run of each scan, in tabs. Scans run every US trading day after the close. Tap a result to open it on the chart."]],
  ["Backtests", [
    "Strategies: each rule's build years (2006–2021) and held-back years (the last 5) side by side. Only the held-back column stands for what to expect.",
    "Options: iron condors and flies, and monthly credit spreads, debit spreads, iron condors and call and put condors, tested with modelled prices. The chips at the top pick a group. Monthly ones run about a month, every day with no direction rule, each managed one way: held to expiry, take 50%, close at 21 days left, or a stop at twice the credit.",
    "0DTE: the same-day research. It shows how many strategies were tried, how many survived the false-discovery check, and whether they held up on data they weren't chosen on. Prices are modelled until real quotes are bought or recorded.",
    "Pattern lab: conditions that came before VIX spikes, every pattern counted and checked against luck.",
    "Each backtest also shows what $5,000 would have become, with every trade risking 2% of the balance. Trades too big for 2% at one contract are skipped and counted.",
  ]],
  ["Safety and orders", [
    "The kill switch stops all trading: it drops waiting orders, and the bot cancels anything working.",
    "Waiting: orders the bot has proposed. Tap one to approve or reject it. Approving doesn't send it straight away: the bot checks every limit again first.",
    "Strategies the bot runs: switch one on, and at its entry time each trading day the bot proposes the trade if the setup is there.",
    "A strategy can expire the same day, in 3 or 9 trading days, or in about a month. Multi-day ones hold one position at a time overnight, take profit or stop whenever the bot checks, and settle at the expiry's close. The 3-day and 9-day condor presets are the ones in Backtests, Options.",
    "Limits: the most a trade or a day may lose, positions at once, capital at risk, and how old prices may be. While the daily limit is empty, every order is refused.",
    "Paper trading only. Live trading can't be turned on from the app.",
  ]],
  ["Phone notifications", ["The bot tells your phone, through the free ntfy app, when an order is waiting for you, filled, closed or stopped, and when the daily loss limit is reached. Each is told once. Tap one, then open Stock Wizard's Safety and orders to act on it."]],
  ["Claude", ["Ask in plain words: run a test, explain a result, put an indicator on the chart. Claude can't place orders or change limits, and everything it does is recorded. Up to 100 questions a day."]],
  ["Getting the latest version", ["⋯, then Get latest version, reloads the newest build. The build number is at the bottom of the ⋯ menu."]],
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
  ["0DTE", "Zero days to expiry: opened and finished the same day."],
  ["Delta", "How much the position gains or loses for a $1 move. A short strike's delta is roughly its chance of finishing in the money: 15 delta ≈ 15%."],
  ["Theta", "What time decay earns or costs each day."],
  ["Vega", "What a 1-point rise in volatility does to the position."],
  ["Expected move", "The range the market expects to about 2 chances in 3, worked out from option prices."],
  ["VIX / VIX1D", "The market's expected volatility: the VIX over 30 days, VIX1D over one day. Around 12–15 is calm; 25 and above is fear."],
  ["VWAP", "The day's average price weighted by volume. Above it and rising is bullish."],
  ["Opening range", "The high and low of the first 30 minutes."],
  ["Natural price", "Selling at the bid and buying at the ask, the price you can count on getting. The mid is halfway between."],
  ["Slippage", "Getting a worse price than expected, especially on fast moves."],
  ["Held-back years", "Years a rule never saw while it was being made. Only results there stand for what to expect, and they can only be used once."],
  ["False-discovery check", "When hundreds of rules are tried, some look good by luck. This check (Benjamini-Hochberg) only passes those too strong to be luck."],
  ["Paper trading", "Practice orders with pretend money at Interactive Brokers. Nothing real is at stake."],
];

export default function HelpScreen() {
  return (
    <div className="list help">
      <h2>The screens</h2>
      {SCREENS.map(([title, lines]) => (
        <details key={title} className="helpitem">
          <summary>{title}</summary>
          <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        </details>
      ))}
      <h2>Terms</h2>
      {TERMS.map(([term, what]) => (
        <details key={term} className="helpitem">
          <summary>{term}</summary>
          <p>{what}</p>
        </details>
      ))}
    </div>
  );
}

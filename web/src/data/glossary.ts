// What each term and setting means, in plain words (Ben, 19 Nov 2026). The (i) buttons
// beside settings and numbers open these, and Help's Terms list shows them all, so each
// explanation is written once. `help` marks the ones listed under Help, Terms.

export interface Term {
  title: string;
  text: string;
  help?: boolean;
}

export const GLOSSARY = {
  // Options
  callput: { title: "Call / put", help: true, text: "The right to buy (call) or sell (put) at a set price, the strike, until the expiry. One contract covers 100 shares." },
  creditdebit: { title: "Credit / debit", help: true, text: "A credit is money received to open a position (selling); a debit is money paid (buying)." },
  spread: { title: "Spread", help: true, text: "Selling one option and buying another further out, so the most you can lose is capped: defined risk." },
  bullputbearcall: { title: "Bull put / bear call", help: true, text: "Credit spreads that profit if the price stays above (bull put) or below (bear call) a level." },
  ironcondor: { title: "Iron condor", help: true, text: "A bull put and a bear call together: profits if the price stays inside a range." },
  debitspread: { title: "Debit spread", help: true, text: "Buying one option and selling another further out: you pay up front, and the most you can lose is what you paid. A bull call spread profits if the price rises; a bear put spread if it falls." },
  condor: { title: "Call / put condor", help: true, text: "Four strikes all of one type, bought for a debit: profits if the price ends between the two middle strikes. The same shape as an iron condor, paid for up front instead of received." },
  ironfly: { title: "Iron fly", help: true, text: "A condor with both short strikes at the current price. A bigger credit, but it needs the price to stay close." },
  wing: { title: "Wing", help: true, text: "The option bought further out that caps the loss. Wider wings cost less to buy but let a loss run further." },
  dte: { title: "0DTE / DTE", help: true, text: "Days to expiry. 0DTE: opened and finished the same day." },
  atr: { title: "Daily range (ATR)", help: true, text: "How far the price typically moves in a day, averaged over 14 days. Strikes placed 'one daily range out' sit that far from the price." },
  delta: { title: "Delta", help: true, text: "How much the position gains or loses for a $1 move in the price, in shares. A short strike's delta is roughly its chance of finishing in the money: 15 delta ≈ 15%." },
  gamma: { title: "Gamma", help: true, text: "How fast delta changes as the price moves. High gamma means the position's risk changes quickly, as it does near expiry." },
  theta: { title: "Theta", help: true, text: "What time decay earns or costs each day, in dollars. Sellers of options usually earn it; buyers pay it." },
  vega: { title: "Vega", help: true, text: "What a 1-point rise in volatility does to the position, in dollars." },
  pop: { title: "Chance of profit", help: true, text: "How often, in theory, the position ends with a profit if held to expiry with no changes. Worked out from the price and volatility, not from history." },
  expectedmove: { title: "Expected move", help: true, text: "The range the market expects the price to stay inside about 2 times in 3, worked out from option prices (or the VIX)." },
  vix: { title: "VIX / VIX1D", help: true, text: "The market's expected volatility: the VIX over 30 days, VIX1D over one day. Around 12–15 is calm; 25 and above is fear." },
  vwap: { title: "VWAP", help: true, text: "The day's average price weighted by volume. Above it and rising is bullish." },
  openingrange: { title: "Opening range", help: true, text: "The high and low of the first 30 minutes of the US session." },
  direction: { title: "Direction", text: "Bullish when the price is above both the opening range and VWAP, bearish when below both, otherwise neutral. Directional strategies use it to pick a side." },
  squeeze: { title: "Squeeze", help: true, text: "Bollinger bands inside the Keltner channel: the price is coiling. 'Fired' is when it breaks out of it." },
  natural: { title: "Natural price", help: true, text: "Selling at the bid and buying at the ask: the price you can count on getting. The mid is halfway between." },
  slippage: { title: "Slippage", help: true, text: "Getting a worse price than expected, especially on fast moves." },
  targetstop: { title: "Profit target / stop", help: true, text: "Close early when the trade has made a set share of the most it can make (take 50%), or lost a set amount (a stop at 2× the credit)." },
  // Testing
  heldback: { title: "Build years / held-back years", help: true, text: "Build years are where a rule was made. Held-back years are years it never saw while it was being made. Only results there stand for what to expect, and they can only be used once." },
  burned: { title: "Burned", text: "The held-back years have been looked at after a change to the rule. Its held-back result no longer counts as unseen: treat it like a build result." },
  fdr: { title: "False-discovery check", help: true, text: "When hundreds of rules are tried, some look good by luck. This check (Benjamini-Hochberg) only passes those too strong to be luck." },
  modelled: { title: "Modelled prices", help: true, text: "Option prices worked out with Black-Scholes and the VIX, not real quotes. Real fills, especially on the wings, usually cost more." },
  kitty: { title: "The $5,000 kitty", help: true, text: "What $5,000 would have become, trade by trade, risking 2% of the balance on each. A trade too big for 2% at one contract is skipped and counted." },
  freedata: { title: "Free data", text: "Some early years come from Yahoo's free candles, kept on Ben's PC because Interactive Brokers' history doesn't reach back that far. Results that use them aren't reported as validated." },
  tested: { title: "Tested / untested", help: true, text: "A tested automated strategy runs exactly the settings a backtest tested. Change any of them and it's untested until backtested again. Only tested ones can be switched on." },
  // Trading and safety
  paper: { title: "Paper trading", help: true, text: "Practice orders with pretend money at Interactive Brokers. Nothing real is at stake. Live trading can't be turned on from the app." },
  killswitch: { title: "Kill switch", help: true, text: "Stops all trading at once: waiting orders dropped, working orders cancelled, nothing new until you turn trading back on." },
  maxtrade: { title: "Most a trade may lose", text: "An order is refused if its worst case (the most the structure can lose, with costs) is more than this." },
  maxday: { title: "Most a day may lose", text: "Once today's losses reach this, every new order is refused until tomorrow. While it's empty, every order is refused: set it before trading." },
  positions: { title: "Open positions at once", text: "The most structures open at the same time. A new order is refused when you're already at it." },
  capital: { title: "Capital at risk", text: "The total worst case of everything open, plus the new order. Refused if it would go over this." },
  dataage: { title: "Oldest prices allowed", text: "An order is refused if its prices are older than this. Delayed prices (no market data subscription) count as 15 minutes old: 900 seconds." },
  approval: { title: "I approve each one / Automatic", text: "Approve: every order waits for you in Trading. Automatic (paper only): an order that passes every limit is sent straight away. Either way every limit is checked." },
  accesskey: { title: "Access key", text: "What Stock Wizard on your PC signs in with. It can only see the shared market data and touch your own orders. It's shown once when made; making a new one stops the old one." },
  pcline: { title: "The PC line", text: "What Stock Wizard on your PC is doing, from the heartbeat it sends every 30 seconds: whether trading is connected to TWS, and on Ben's PC whether market data is running. Red or old means the PC is off, asleep, or TWS isn't logged in." },
  live: { title: "Live / Delayed", text: "In US market hours the chart adds today's bars every 5 seconds. Live means real-time prices; Delayed means about 15 minutes late, when there's no market data subscription." },
  tws: { title: "TWS's connection (API)", text: "Stock Wizard talks to Interactive Brokers through TWS on the same PC, on port 7497 (paper trading). TWS has to be open, logged in to Paper Trading, with its API turned on. Live ports are refused." },
  delayedprices: { title: "Real-time or delayed prices", text: "Without a market data subscription, Interactive Brokers sends prices about 15 minutes late. Choose Delayed so Stock Wizard knows; delayed prices count as 15 minutes old against your limits." },
  ntfy: { title: "Phone notifications", text: "Through the free ntfy app: an order waiting for you, filled, closed or stopped, and the daily limit reached. The topic name is like a password: make it hard to guess." },
  marketdata: { title: "Market data for everyone", text: "On Ben's PC only: it fetches the candles for the symbol list from Interactive Brokers, streams live bars in US hours and runs the scans, for everyone who uses Stock Wizard." },
  screens: { title: "Screens", text: "Give each monitor a job and Stock Wizard opens a window on it: Main chart (the working chart), Watch page (your chart page) or Trading (what's running). Only on the PC program." },
  entrytime: { title: "Entry time", text: "The time (New York) an automated strategy looks for its trade, once a day. It has 15 minutes after it to propose; Stock Wizard must be running on your PC then." },
} satisfies Record<string, Term>;

export type TermKey = keyof typeof GLOSSARY;

# Technical Trading Workspace: Proposal

Exported from the Claude doc "Technical Trading Workspace: Proposal" on 16 Nov 2026. Owner: Ben. This is the reasoning behind `SPEC.md`; where the two differ, `SPEC.md` and the "Decisions so far" section below are the later word.

## Summary

Build a simple browser-based candlestick charting and scanning workspace on your existing Postgres first, and add bot execution only after 6 to 8 months of research and paper trading.

- **Charts you can bend to your style:** candlesticks as the main view, with the standard technical tools and a squeeze indicator built from the public Bollinger/Keltner concept.
- **Saved workspaces:** one tab per symbol or idea, each remembering its charts, timeframes and indicators, so you stop jumping between windows.
- **A scanner:** scheduled scans across a symbol list for setups such as a squeeze on, a squeeze firing, breakouts and SPY correction signals.
- **Research before bots:** the same signals get tested on history (including SPY signals against VIX moves) before any order logic exists.
- **Execution last:** a paper-trading bot behind hard safety rails, on a broker we choose after the research.

## Scope

Version 1 is charts, saved workspaces and a scanner. Nothing that places an order is built until phase 4.

**In**

- Candlestick charts from 1-minute to monthly, with adjustable colours, layout and indicator settings.
- Indicators: moving averages, Bollinger Bands, Keltner Channels, RSI, MACD, ATR, volume, VWAP, and a squeeze indicator with momentum histogram.
- Drawing tools: horizontal levels and trendlines, saved with the chart.
- Workspaces: tabs for symbols, each with its own chart set, plus watchlists.
- Scanner: scheduled scans over a symbol list, results table that opens the chart.
- An installable phone version of the same site (a web app you add to your home screen), not a separate native app.

**Out, on purpose**

- Order entry, until the paper-trading phase.
- News, fundamentals, social features, multiple users.
- Native App Store or Play Store apps.
- Anything that copies Simpler Trading's proprietary tools: we build our own squeeze from the publicly described method (Bollinger Bands inside the Keltner channel, plus a momentum histogram).

## Indicator shortlist

Thirty standard indicators, most needing only price data. Which ones earn a place is decided by the backtests, not by this list.

| Indicator | Group | Used for | Data needed |
| --- | --- | --- | --- |
| EMA 9, 21, 50, 200 | Trend | Direction and pullback levels | Price |
| SMA 200 | Trend | Long-term trend filter | Price |
| MACD | Trend | Momentum shifts inside a trend | Price |
| ADX | Trend | Trend strength | Price |
| Supertrend | Trend | Trailing stop and trend flips | Price |
| Bollinger Bands | Volatility | Range and extremes | Price |
| Bollinger %B and bandwidth | Volatility | Measuring compression | Price |
| Keltner Channels | Volatility | Squeeze partner to Bollinger | Price |
| Squeeze with momentum histogram | Volatility | Compression, then breakout direction | Price |
| ATR | Volatility | Stop distance and position size | Price |
| Donchian channels | Volatility | Breakout levels | Price |
| RSI | Momentum | Overbought, oversold | Price |
| Stochastic | Momentum | Short-term turns | Price |
| Rate of change | Momentum | Raw momentum | Price |
| Divergence detector | Momentum | Price against RSI or MACD, for correction signals | Price |
| Volume and relative volume | Volume | Confirming moves | Price and volume |
| On-balance volume | Volume | Accumulation or distribution | Price and volume |
| VWAP and anchored VWAP | Volume | Intraday fair value | Intraday price and volume |
| Prior day high, low, close and gap | Levels | Reference levels for 0DTE | Price |
| Opening range (first 30 or 60 minutes) | Levels | Breakout entries for 0DTE | Intraday price |
| Pivot points | Levels | Support and resistance | Price |
| VIX level and its Bollinger position | Volatility index | Spotting stretched fear readings | VIX |
| VIX term structure | Volatility index | Contango or backwardation, key for VIX calls | VIX and VIX futures |
| SPY drawdown from recent high | Market | Correction trigger | Price |
| Percent of S&P 500 stocks above 50 and 200-day average | Market | Breadth warning | Breadth data |
| Put/call ratio | Options | Sentiment | Options data |
| Open interest by strike | Options | Price walls for 0DTE | Options data |
| IV rank and percentile | Options | Is premium cheap or rich | Options data |
| Expected move from implied volatility | Options | Strike distance for 0DTE | Options data |
| Relative strength versus SPY | Market | Filtering weak or strong stocks | Price |

## Phased plan

The plan runs six to eight months in four phases, with a gate before each step toward real money.

*(The roadmap diagram, 4 phases and 3 gates, is in the Claude doc. `SPEC.md` has the build order that replaces it.)*

Phases 1 and 2 need only market data. The broker is chosen at the end of phase 3, and the last gate decides whether any live money is used.

## Backtesting engine

The backtester replays history one candle at a time and only ever shows the strategy the candles up to the current one, so it cannot peek at the future.

1. Load the candles in time order, for example 10,000 of them.
2. At each candle, give the strategy that candle and the ones before it, nothing later.
3. Calculate indicators from past candles only, and evaluate signals when the candle closes.
4. An entry signal places an order that fills at the next candle's open, never on the candle that produced the signal.
5. Check every open position on each candle against its exit rules (target, stop, time limit, opposing signal), with exits filled under the same no-peeking rule.
6. Charge commissions and slippage on every fill, and log each trade with its timestamp, so the run reads as a true timeline.

**Rules that keep it honest**

- **Truncation test:** automatically re-run with the last candles removed. Signals on earlier candles must not change. If they do, something is using the future.
- **Stop and target in the same candle:** assume the stop was hit first.
- **Options:** fill at the bid or ask, not the mid. Historical option prices are costly, so version 1 tests signals on the underlying (SPY) and VIX futures and approximates the option leg.
- **No tuning on everything:** build rules on an early block of history, then test once on later data the rules never saw (walk-forward).

A blind engine makes results honest, not strong. Adjusting rules until the backtest looks great is the usual way to get results that fail live, so a result that looks too good is treated as a warning, not a win.

## Architecture

One Postgres database sits in the middle, so the app, the scanner and the later bot all read and write the same signals.

*(The architecture diagram, 7 parts around one database, is in the Claude doc.)*

The stack is my suggestion, not a settled choice: a Python backend, a React front end using an open-source candlestick chart library (check its licence before we commit), and the site packaged so your phone can install it. Dashed boxes are phase 4 only.

## Broker and data decisions

Build the platform so it does not depend on any one broker, and pick the execution broker at the end of phase 3. Phases 1 to 3 need only market data, not a broker account.

| Route | What it gives you | Watch out for |
| --- | --- | --- |
| IG (demo account) | A REST/streaming API with a demo endpoint, plus ProRealTime and MetaTrader for automation. Good for testing bot plumbing. | IG's automated trading is leveraged CFDs. ASIC found at least 68% of retail CFD investors lost money in 2023-24, and 72% for options CFDs. It is not the same as trading real US options. |
| Interactive Brokers | Real shares and options (US and ASX), a Python API, a paper account with the live account, no account minimum. | The live account must be funded to use the API, and there may be a wait. Market-data subscriptions cost extra. |
| Option Alpha with TradeStation | No-code bots, strong 0DTE and backtesting tools, Australia listed as supported via TradeStation. | TradeStation issues its own API key only with a $10,000 funded account. Your cost and funding at a small size are unconfirmed. |

Market data is the other open decision: the charts and scanner need a reliable daily and intraday candle feed. Free unofficial sources break without notice, so we should choose one source (and its cost) before phase 1 starts. Options data is only needed from phase 3.

## Risk, gates and expectations

A 20 to 30% yearly gain for your children's accounts is not something this system can promise, and those accounts should not fund it. This is general information, not financial or tax advice.

- **The odds are poor for most traders.** ASIC found at least 68% of retail CFD investors lost money in 2023-24. Option Alpha's own data shows 49.64% of its 0DTE traders are profitable, and a high win rate does not mean profit when occasional losses are large.
- **Scale is small.** A 25% year on $1,000 is $250 before fees and tax. The value of this project is the skill and the tested process, not the dollars.
- **Keep the children's money separate.** Leave those accounts in their current investments. Revisit only after a documented live track record, and talk to an accountant about the tax and trustee rules for trading in a child's name.
- **Use only money you can afford to lose** for live trading, at the smallest size, once the gates below are met.

**Suggested go/no-go gates** (we set the numbers together):

1. Signals show a positive result in backtests after commissions and slippage.
2. At least 3 months of paper trading with results close to the backtest.
3. A maximum drawdown limit you set in advance, never breached in paper.
4. Safety rails tested: per-trade and per-day loss caps, position limits, kill switch, stale-data stop.

## Decisions so far

Execution is on Interactive Brokers, and the work moves to Claude Code once a Supabase repository exists.

- **Broker:** Interactive Brokers. IG is dropped.
- **Data:** delayed data is fine for the scanner. Bot-traded instruments get the closest to real-time data IBKR offers.
- **Database:** Supabase (Postgres). You will create the project and repository next.
- **Universe:** US stocks and ETFs, plus an ASX watchlist for monitoring only. No ASX trading unless there is a clear reason.
- **Timeframes:** 5 minutes and above, with hourly usually enough.
- **App:** an installable web app, with Claude built into it. Claude can read charts and saved backtests, build indicators and run backtests. It cannot place live orders without your approval, and it cannot change the safety limits.
- **Strategies, in order:** VIX spike spreads, then 0DTE condors and butterflies, then squeeze-based setups.
- **Saved backtests:** stored in the app for review, with win rate, average win, average loss and drawdown.
- **Early risk:** trades risking under $50, as long as profits keep the account going. The daily limit is set once we see real spread prices.
- **Starting account:** $1,000 to $2,000.
- **History:** you asked for 20 years. That works for daily-candle SPY and VIX signal tests. Daily SPX expiries only began in 2022, and option price history is costly, so 0DTE and options tests will cover a shorter period.

## Open questions

- [ ] Create the Supabase project and repository, then share access so the work can move to Claude Code.
- [ ] Real-time data: confirm the IBKR data subscriptions and their monthly cost once the account is open.
- [ ] Choose a source for 20 years of history: daily SPY and VIX data, plus any paid intraday or options history.
- [ ] Confirm how IBKR applies day-trade rules to an Australian account of $1,000 to $2,000, since it affects 0DTE.
- [ ] Pick which indicators from the shortlist must be in version 1.
- [ ] Set a maximum loss per day once real spread prices are known.

## Sources

Figures come from web search results on 16 November 2026, not from full page reads. Confirm each with the provider before committing money.

- [Moneysmart on CFDs](https://moneysmart.gov.au/investment-warnings/contracts-for-difference-cfds): 68% of retail CFD investors lost money in 2023-24.
- [Finance Magnates on ASIC data](https://www.financemagnates.com/forex/etoro-dominates-australias-cfd-market-where-trader-loyalty-rarely-survives-a-year): 72% loss rate for options CFDs.
- [Option Alpha 0DTE research](https://optionalpha.com/bots/0dte-research-insights-bot): 49.64% of its 0DTE traders profitable.
- [IG API guide](https://www.ig.com/au/trading-platforms/trading-apis/how-to-use-ig-api) and [IG automated trading](https://www.ig.com/au/trading-platforms/algorithmic-trading/what-is-automated-trading): demo endpoint, CFD-based automation.
- [IBKR required minimums](https://www.interactivebrokers.com.au/en/accounts/required-minimums.php) and [IBKR Web API access](https://www.interactivebrokers.com/docs/web-api/trading/getting-started/trading-access-for-individuals.md): no minimum, funded live account for API.
- [TradeStation Web API page](https://www.tradestation.com/platforms-and-tools/web-api/): $10,000 funded balance for an API key.
- [Option Alpha integrations](https://optionalpha.com/integrations): Australia listed under TradeStation.

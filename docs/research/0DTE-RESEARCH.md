# Same-day (0DTE) options spreads: market and evidence review

Stage 1 of Ben's 0DTE research brief (18 Nov 2026): the market, the
instruments, the published evidence, data sources and what they cost, and
what this means for Stock Wizard. Every figure is from the sources listed at
the end. Many come from secondary or commercial sources and are marked as such.
Check prices and fees with the vendor before relying on them.

## The short answer

- **No independent study shows a same-day spread-selling edge that survives
  real costs.** The most thorough academic study (Vilkov, revised 2026) found
  a real but small premium for selling same-day volatility. After its own
  August 2026 correction to transaction costs, *no strategy or basket keeps a
  positive Sharpe ratio after costs*. Retail traders as a group lose money in
  0DTE, and about 60% of those losses are transaction costs (Beckmeyer,
  Branger and Gayda).
- **Costs and fills decide the answer,** so a modelled backtest like ours can't
  settle it. Real intraday option quotes are needed (see "Data").
- **Your $50 limit is tight.** A $1-wide spread on SPY or XSP risks up to $100,
  less the credit. Only near-the-money $1 structures fit under $50; a
  15–20-delta $1-wide credit spread usually doesn't. That's your call; the
  research will show what each limit allows.

## The market

- 0DTE is now most of S&P 500 index options trading: a record **66.2% of SPX
  volume in July 2026** (Cboe). The share swings from month to month; it was
  about 50% in April 2026 and 63% in February.
- **XSP** (mini-SPX) set records in July 2026: 238 thousand contracts a day,
  138 thousand of them 0DTE (Cboe).
- Retail is reported at roughly **50–60% of SPX 0DTE volume**, and **over 95% of
  0DTE trades use defined-risk structures** (a secondary report of Cboe
  research; not checked against the original).
- Cboe partly credits 2026's growth to the end of the US pattern-day-trader
  rule. IBKR says accounts may stay under the old rule through a transition to
  October 2027. How that applies to an Australian account is still open: ask
  IBKR.

## The instruments

| | SPX / SPXW | XSP | SPY | QQQ |
|---|---|---|---|---|
| Size | S&P 500 × $100 (about $600k notional) | 1/10 of SPX (about $60k) | ETF, about 1/10 of SPX | Nasdaq-100 ETF |
| Settlement | Cash | Cash | Shares | Shares |
| Exercise | European (only at expiry) | European | American (any time) | American |
| Early assignment risk | None | None | Yes, on short legs in the money, and around dividends | Yes |
| Typical bid-ask near the money* | $0.10–0.50 | $0.05–0.15 | $0.01–0.03 | Tight |
| Exchange fee per contract* | about $0.45 (sources disagree) | about $0.07 on 10+ (sources disagree) | small | small |
| A $1-wide spread risks | (strikes are $5 apart: a $5-wide spread risks up to $500) | up to $100 | up to $100 | up to $100 |
| Fits a $50 limit | No | Only near the money | Only near the money | Only near the money |

\*Blog and broker figures, not exchange data. They vary by time of day and by
how far from the money the strike is. The US tax advantage of index options
(section 1256) doesn't apply to an Australian resident.

**For a $1,000–2,000 account:** XSP has the same settlement as SPX (cash, no
early assignment) at a tenth of the size, but wider spreads relative to its
price. SPY has the tightest spreads but carries assignment risk on short legs.
Both are worth testing. SPX itself is too large for the account.

## The evidence

### Academic (working papers unless noted)

- **Vilkov, *0DTE Trading Rules*** (SSRN, revised March 2026; data Sept 2016 to Feb 2026).
  - **What it found:** a positive same-day variance risk premium, but small at same-day horizons and "difficult to monetize after realistic frictions". Profit and loss is dominated by tail risk.
  - **The 10:00 rules:** conditional rules made at 10:00 New York time looked good out of sample.
  - **The August 2026 correction** (in its GitHub replication package): costs had been charged at 1/100 of their true size. Corrected, *no strategy or basket keeps a positive net Sharpe ratio*.
- **Beckmeyer, Branger and Gayda, *Retail Traders Love 0DTE Options… But Should They?*** (SSRN, 2023–24).
  - Retail traders lose substantially on 0DTE, and about 60% of the losses are transaction costs.
  - Multi-leg trades did better than single options but still lost on average.
- **Muravyev and Ni** (Journal of Financial Economics, 2020, *peer-reviewed*): the short-volatility premium in S&P 500 options is earned **overnight**. During the day, delta-hedged option returns are positive, which cuts against selling same-day premium.
- **Dim, *0DTEs: Trading, Gamma Risk and Volatility Propagation*:** finds a positive same-day realised variance risk premium in every 30-minute bar.
- **Khalil:** a strategy harvesting the premium with a Sharpe ratio of about 1.4. More 0DTE trading goes with a lower premium.
- **Almeida, Freire and Hizmeri, *0DTE Asset Pricing*** (2025, read through a summary): a large positive same-day premium, mostly compensating upside moves. About 70% of 0DTE prices break theoretical price bounds.
- **What they agree on:** a premium for selling same-day volatility exists. They disagree on whether it survives costs, and the most careful, corrected study says it doesn't.

### Practitioner and commercial (not independent)

- **Option Alpha, about 25,000 trades:** iron flies won 72% against 63% for condors. Condors opened in the first two hours lost on average; flies were about flat.
- **OptionKrafter:** 16-delta SPY condors at 10:00 (2023–25) won 75.4% but needed 76.6% to break even, so they lost money.
- **Common rules of thumb:** entries between 10:00 and 11:30, shorts outside the expected move, stops at 1–2 times the credit, profit targets of 25–50%. These are starting points to test, not findings.

## Data: what a real backtest needs and what it costs

Real backtests need historical intraday option bid/ask quotes. Free sources
don't have them. As far as I know, IBKR gives no history for options that have
expired. From today, the Stock Wizard bot records real SPY quotes every 30
minutes once it's connected to IBKR, but that history only builds from now.

| Provider | What | Reported price (check before buying) |
|---|---|---|
| ThetaData | Options quotes and trades, 1-minute or tick; history depth varies by plan (sources disagree: about 4–14 years) | $40, $80 or $160 a month (Value / Standard / Pro); personal use only |
| ORATS | 1-minute option chains since August 2020, with implied volatility and Greeks | about $1,500 one-off for the history plus about $199 a month (older pages say $49–199 a month) |
| Cboe DataShop | 1-minute option quote intervals (NBBO, implied volatility and Greeks optional) | no public price list; reportedly about $24–162 for one symbol's 1-minute history, about $740 a day of full-market data |
| IBKR | Live quotes, and history for options still trading | Included with the data subscription; we record our own |

**My suggestion:** ThetaData Standard ($80 a month) is the cheapest route to
minute-level SPXW, XSP and SPY quotes. First confirm with them how far back
each symbol goes. One month is enough to download the history needed. ORATS
is the fallback if its Greeks and implied volatility are wanted ready-made.

## What this means for Stock Wizard

1. **Stage 2 (next, no spending):** build the full framework on modelled prices,
   so it's ready the day real data arrives:
   - strikes by delta
   - VWAP and opening-range filters
   - entries at any time from 09:45 to 14:00
   - profit targets, stops (credit multiple, short-strike breach, delta) and time exits
   - exchange fees per instrument
   - Fed, inflation and jobs-day tagging
   - VIX-regime splits, and the false-discovery check across the whole matrix
2. **Stage 3 (your decision):** buy a month of data, run the matrix on real
   quotes and costs, and keep only what passes the held-back and walk-forward
   tests.
3. **Our own modelled results so far** (Backtests, then Options, family
   `spy_0dte_methods`) disagree with each other:
   - Priced with the VIX, condors look profitable.
   - Priced with VIX1D, which measures same-day volatility more accurately, they don't.
   - That's the expected behaviour of a model without real quotes, and why none of it is evidence.

## Sources

- Vilkov, 0DTE Trading Rules: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4641356 · replication and correction: https://github.com/vilkovgr/0dte-strategies
- Beckmeyer, Branger and Gayda: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4404704 · https://wp.lancs.ac.uk/fofi2024/files/2024/04/FoFI-2024-146-Leander-Gayda.pdf
- Dim: https://westernfinance-portal.org/viewpaper?n=950096
- Khalil: https://research-api.cbs.dk/ws/portalfiles/portal/105671291/1775874_O._Khalil_Zero_Day_to_Expiry_Options_Trading_and_Variance_Risk_Premium.pdf
- Literature summary (Muravyev and Ni, Almeida et al.): https://firmtape.com/research/what-the-0dte-literature-claims
- Cboe July 2026 volume: https://ir.cboe.com/news/news-details/2026/Cboe-Global-Markets-Reports-Trading-Volume-for-July-2026/default.aspx · https://www.cboe.com/insights/posts/market-metrics-that-matter-derivatives-july-2026-volume-highlights
- Cboe February 2026 volume: https://ir.cboe.com/news/news-details/2026/Cboe-Global-Markets-Reports-Trading-Volume-for-February-2026/default.aspx
- Cboe Q2 2026 slides: https://www.investing.com/news/company-news/cboe-q2-2026-slides-record-revenue-0dte-options-surge-to-65-of-spx-93CH-4828641
- Retail share and defined-risk share (secondary): https://joincfu.com/blog/options-trading-statistics
- Option Alpha, 25k trades: https://optionalpha.com/blog/0dte · OptionKrafter: https://optionkrafter.com/blog/0dte-iron-condor
- Instruments and fees: https://www.tradestation.com/insights/2025/05/28/spy-vs-spx-options-explained/ · https://tradewize.io/blog/spy-vs-spx-vs-xsp · https://www.tradealgo.com/trading-guides/options/spx-vs-spy-0dte · https://spxtospy.com/articles/xsp-mini-spx-options.html
- Day-trade rule transition: https://thebrokerbench.com/reference/pattern-day-trader-rule-brokers/
- ThetaData pricing (secondary): https://desktested.com/posts/thetadata-review/ · https://flashalpha.com/articles/options-data-pricing-comparison-flashalpha-thetadata-polygon-spotgamma-squeezemetrics
- ORATS: https://orats.com/one-minute-data · https://flashalpha.com/articles/flashalpha-vs-orats-options-data-api-backtesting
- Cboe DataShop: https://datashop.cboe.com/option-quote-intervals · https://concretumgroup.substack.com/p/spx-options-database-databento-vs · https://stockmarketstack.com/tools/cboe-datashop

# Ben's PC: trading, market data and backtests

Every PC runs the same installed Stock Wizard (setting it up:
[SETUP-BOT.md](SETUP-BOT.md)). Ben's PC does three more things, because its
settings hold the Supabase **secret key** instead of a bot key:

- **Market data** for everyone: candles for the symbol list from Interactive
  Brokers, live bars in US hours, and the scans after each close.
- **The archive**: every candle ever fetched, in
  `%LOCALAPPDATA%\StockWizard\archive.sqlite`, backed up to
  `OneDrive\StockWizard` after each close.
- **Backtests**: right-click the icon by the clock, **Run backtests**.

It only ever trades the **paper** account. It refuses live ports (7496, 4001)
and any account whose number doesn't start with "DU".

## The settings on Ben's PC

Right-click the icon by the clock, then **Settings**:

- **Interactive Brokers**: TWS (port 7497).
- **Delayed prices**: ticked while the paper account has no real-time options
  data.
- **Phone notifications**: the ntfy topic.
- **Market data (this PC only)**: ticked.

The secret key is stored encrypted with Windows' own protection, readable
only by Ben's Windows account. The settings file is
`%LOCALAPPDATA%\StockWizard\stockwizard.env`.

## Running backtests

1. Right-click the **S** icon by the clock.
2. Click **Run backtests**.
3. A notice pops up when they're done (several minutes). The results are in
   the app under **Backtests**.

They run the stock backtests, the option backtests and the pattern lab on the
archive. The full output is in `logs\backtests.log` (icon, **Logs**).

## Keeping the PC ready

- TWS open and logged in to **Paper Trading**, with its API on (port 7497).
- The PC awake through the US session: Start, **Power & sleep settings**,
  **When plugged in, PC goes to sleep after**: **Never**.
- While the PC or TWS is off, the market data stops for everyone. The next
  start fills the gap.

## Good to know

- **Phone notifications** pass through ntfy's server: they say the symbol,
  strikes, prices and profit or loss, nothing else.
- **TWS restarts once a day** and sometimes asks you to log in again. While
  it's down, nothing trades. When it's back, the bot checks its orders and
  positions against Interactive Brokers before doing anything else.
- **Delayed prices** count as 15 minutes old, so a tight stale-data limit
  refuses orders until real-time data is shared with the paper account.
- **Starting Stock Wizard yourself**: Start menu, **Stock Wizard**. Claude
  shouldn't start it from a Claude session: the Claude app keeps a private copy
  of AppData, so a copy started there uses different settings.

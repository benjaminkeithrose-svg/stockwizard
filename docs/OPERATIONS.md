# Stock Wizard: how it runs

Where everything lives, what runs when, and what to do when something goes
wrong. Refreshed 19 November 2026 (through #77): refreshed when Ben asks.

## Where everything lives

| Part | Where | What it does |
|---|---|---|
| The app | GitHub Pages: https://benjaminkeithrose-svg.github.io/stockwizard/ | The screens. Published again on every merge to `main`. Works offline with what it last loaded. Also opens in its own window on a PC with Stock Wizard installed |
| The database | Supabase, project `stockwizard` (Sydney) | The recent candles the app shows, live bars, your charts and settings, backtest results, automated strategies, orders, limits, the audit log, the PC heartbeat. Each person sees only their own rows (on a joint account, both see the account's trading rows); market data is shared |
| Claude in the app | A Supabase function | Answers questions, runs tests. Ben only (`claude_access`). Needs the Anthropic key saved as a Supabase secret |
| Stock Wizard on a PC | Installed from `StockWizardSetup.exe` (GitHub releases) into `%LOCALAPPDATA%\Programs\Stock Wizard` | The app's window, the icon by the clock, trading, and on Ben's PC the market data program. Starts when you sign in to Windows |
| Settings, archive and logs | `%LOCALAPPDATA%\StockWizard` on the PC | `stockwizard.env` (the key encrypted with Windows' own protection), `archive.sqlite` (every candle ever fetched, 1990 on), `logs\` |
| Archive backup | `OneDrive\StockWizard\archive.sqlite` | Copied after each US close, only after the archive passes SQLite's own check; the one before is kept as `archive.previous.sqlite` |
| Market data | Interactive Brokers, through TWS on Ben's PC (read-only, client 30) | Candles for the symbol list (`backend/data/universe.csv`) and live bars in US hours |
| Scheduled jobs on GitHub | GitHub Actions (the Actions tab) | Keeping Supabase awake, the practice cycle with a pretend broker, publishing the app, building the installer |
| Phone notifications | ntfy (free app) | Order waiting, filled, closed or stopped, daily limit reached |

The repository is public, so no keys or personal data are ever in it.

## Keys and where they're kept

| Key | Kept in | Used by |
|---|---|---|
| Supabase secret key | GitHub secret `SUPABASE_SECRET_KEY`; Ben's PC settings, encrypted | The GitHub jobs; Ben's trading, market data and backtests |
| Access key (invited people) | Their PC's settings, encrypted; made by Setup in the app (Menu, Setup, Connect this PC) | Their trading, limited to their own orders |
| ntfy topic name | GitHub secret `NTFY_TOPIC`; the PC settings | Phone notifications |
| Anthropic key | Supabase secret `ANTHROPIC_API_KEY` | Claude in the app |
| Interactive Brokers login | Only in TWS on the PC | Trading and the market data |

## What runs when

All times are Sydney time. They move by an hour when either country changes
its clocks. The US market is open 9:30 am to 4 pm New York time: about
1:30 am to 8 am in Sydney during Australian summer, later in winter.

| Job | When | What it does |
|---|---|---|
| Trading (on the PC) | All the time while Stock Wizard runs | A cycle every 30 seconds: proposes, approves, manages and settles trades; records SPY option quotes every 30 minutes in US hours. On a joint account only the owner's PC trades; the partner's waits |
| Live bars (Ben's PC) | US market hours | Today's 1-minute bars to Supabase every 5 seconds, finished 5-minute candles every 5 minutes |
| After the close (Ben's PC) | About 8 to 9 am | Adds the day's candles (daily, hourly, 5-minute and 1-minute) to the archive and Supabase, runs the scans, checks the archive and backs it up to OneDrive |
| Heartbeat | Every 30 seconds | The PC line under the app's header |
| Backtests | By hand: right-click the icon by the clock, **Run backtests** (Ben's PC only) | The stock backtests, the option backtests and the pattern lab, on the archive; a notice when done; `logs\backtests.log` |
| Updates | The app checks each time it opens; the icon checks GitHub at start and every 6 hours | One button, Menu, **Updates and what's new**, **Update**, updates whatever is behind: the app, and on the PC Stock Wizard itself (it waits for the US close). **Update to …** on the icon also works |
| Keep Supabase awake | Monday and Thursday mornings | A small request, so the free project isn't paused |
| Practice cycle (pretend broker) | Every 10 minutes in US hours, from GitHub | A practice cycle with made-up prices. To be turned off now trading runs on the PC |
| Publish the web app | On every merge | Runs the web tests, builds the app, publishes it |
| Build the installer | On every merge that changes the PC program | Builds `StockWizardSetup.exe` and publishes it as a release |

## Supabase's window and the archive

Supabase keeps only what the app shows: daily candles for 5 years, hourly for
2 years, 5-minute for 60 days, 1-minute for 7 days (15- and 30-minute candles
are built from the 5-minute ones in the app and in Claude). The archive on
Ben's PC keeps everything:
IBKR's daily history as far back as IBKR goes (SPY from 1993), and Yahoo's
older candles, kept for the years IBKR doesn't reach (the VIX before October
2005). Backtests read the archive, repairing a few misplaced-decimal highs and
lows in IBKR's old candles as they read them.

The archive guards itself. Each time it opens, SQLite's own check runs; a
damaged archive is moved aside as `archive.damaged-<date>.sqlite` (never
deleted) and the OneDrive backup is put back in its place. A damaged archive is
never backed up, so a good backup isn't overwritten.

To fetch IBKR's full daily history again (TWS logged in, on Ben's PC):

```
python -m stockwizard.run_data --deepen
```

## When something goes wrong

### The app shows old screens or old numbers
1. Tap **Menu** (top right).
2. Tap **Updates and what's new**, then **Update**.
3. If it still looks old, close the app fully and open it again.

### The PC line says waiting or stopped
1. On the PC, check TWS is open and logged in to **Paper Trading**. TWS
   restarts once a day and sometimes asks you to log in again.
2. Stock Wizard tries again every minute. The icon by the clock turns green
   when it's connected.
3. If it stays amber or red, right-click the icon, click **Logs**, open
   `bot.log` or `data.log`, and send me the last lines.
4. After a reconnect, Stock Wizard checks its orders against Interactive Brokers
   before trading. If they don't match, it stays stopped and says why.

### Stock Wizard isn't running on the PC
1. Click **Start**, type **Stock Wizard**, and open it.
2. If the icon is amber and says **Not set up yet**, this PC isn't connected:
   in Stock Wizard, **Menu**, **Setup**, **Connect this PC**.
3. Keep the PC from sleeping: Start, **Power & sleep settings**, set **When
   plugged in, PC goes to sleep after** to **Never**.

### The log says the archive was damaged
1. Nothing to do at once: Stock Wizard has already set the damaged archive
   aside and put the OneDrive backup in its place.
2. The next after-close update fills in any days the backup was missing.
3. If it says the backup was damaged too, don't delete anything: send me the
   last lines of `data.log`.

### A joint account: the partner sees nothing, or can't share
1. The partner must have signed in to Stock Wizard at least once before
   they can be added.
2. Each person can be on one joint account only, and a partner can't share
   an account of their own.
3. The partner's PC line shows the owner's PC: if it says off, the owner's PC
   or TWS is off, and nothing trades until it's back.

### Every order is refused
1. Open **Menu**, then **Trading**, **Orders**, **Not traded**.
2. Tap the order: it lists every rail it failed.
3. The usual causes:
   - the daily loss limit is empty
   - the trade risks more than the per-trade limit
   - the prices are older than your limit (delayed data counts as 15 minutes old)

### An automated strategy didn't trade
1. Open **Today**.
2. Read its line:
   - "no trade" with a reason (VIX range, no setup, a skipped day, a position still open)
   - or "your PC may not have been running at the entry time", meaning Stock Wizard wasn't running then

### A scheduled job on GitHub failed (GitHub emails you)
1. Open the repository on github.com.
2. Click **Actions**.
3. Click the failed run (red cross), then the failed step, and read the last lines.
4. Send me a screenshot.

### Supabase says the project is paused
1. Sign in at supabase.com.
2. Open the `stockwizard` project.
3. Click **Restore**. Nothing is lost. The keep-awake job normally prevents this.

## Checking it still works

The automated checks run on every pull request:

- the Python tests (indicators, rules, backtests, trading, safety rails, the PC program)
- the app's tests
- the built app in a headless browser
- the database security rules on a local copy

None of them uses real market data, the live database, Interactive Brokers
or a phone. Those are checked by using the app.

## Changes

What changed, and when: [CHANGELOG.md](../CHANGELOG.md).

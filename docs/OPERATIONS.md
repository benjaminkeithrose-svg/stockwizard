# Stock Wizard: how it runs

Where everything lives, what runs when, and what to do when something goes
wrong. Baseline of 18 November 2026: refreshed when Ben asks.

## Where everything lives

| Part | Where | What it does |
|---|---|---|
| The app | GitHub Pages: https://benjaminkeithrose-svg.github.io/stockwizard/ | The screens. Published again on every merge to `main`. Works offline with what it last loaded |
| The database | Supabase, project `stockwizard` (Sydney) | Candles, your charts and settings, backtest results, bots, orders, limits, the audit log. Each person sees only their own rows |
| Claude in the app | A Supabase function | Answers questions, runs tests. Needs the Anthropic key saved as a Supabase secret |
| Scheduled jobs | GitHub Actions (the Actions tab) | Candle top-up and scans, keeping Supabase awake, the pretend-broker bot |
| The bot (real paper trading) | Your Windows PC, with IB Gateway | Trades your Interactive Brokers paper account. Set up with [PC-BOT.md](PC-BOT.md) |
| Phone notifications | ntfy (free app) | Order waiting, filled, closed or stopped, daily limit reached |

The repository is public, so no keys or personal data are ever in it.

## Keys and where they're kept

| Key | Kept in | Used by |
|---|---|---|
| Supabase secret key | GitHub secret `SUPABASE_SECRET_KEY`; `pc/stockwizard.env` on the PC | The jobs and the bot |
| ntfy topic name | GitHub secret `NTFY_TOPIC`; `pc/stockwizard.env` on the PC | Phone notifications |
| Anthropic key | Supabase secret `ANTHROPIC_API_KEY` | Claude in the app |
| Interactive Brokers login | Only in IB Gateway on the PC | The bot |

## What runs when

All times are Sydney time. They move by an hour when either country changes
its clocks.

| Job | When | What it does |
|---|---|---|
| Top up candles | Every US trading day, about 8 to 9 am | Loads the last 10 days of candles, then runs the scans |
| Keep Supabase awake | Monday and Thursday mornings | A small request, so the free project isn't paused for being idle |
| Paper bot (pretend broker) | Every 10 minutes, about midnight to 9 am, Tuesday to Saturday | A bot cycle with made-up prices. Turned off once the PC bot runs |
| Publish the web app | On every merge | Runs the web tests, builds the app, publishes it |
| Run backtests and the pattern lab | By hand only | Actions tab → "Run backtests and the pattern lab" → Run workflow |
| The PC bot | While its window is open | A cycle every 30 seconds |

The US market is open 9:30 am to 4 pm New York time. That's about 1:30 am to
8 am in Sydney during Australian summer, and later in winter.

## When something goes wrong

### The app shows old screens or old numbers
1. Tap ⋯.
2. Tap **Get latest version**.
3. If it still looks old, close the app fully and open it again.

### A scheduled job failed (GitHub emails you)
1. Open the repository on github.com.
2. Click **Actions**.
3. Click the failed run (red cross), then the failed step, and read the last lines.
4. Send me a screenshot. Most failures are the free data source being down for a while; the next run usually catches up.

### The bot on the PC stopped or disconnected
1. Look at the bot window. If it says IB Gateway disconnected, open IB Gateway and log in to **Paper Trading** again (approve it in IBKR Mobile).
2. If the bot window has closed, double-click `start-bot.bat` again.
3. After a reconnect, the bot checks its orders against Interactive Brokers before trading. If they don't match, it stays stopped and says why. Send me that text.

### Every order is refused
1. Open ⋯ → Safety and orders.
2. Tap the order: it lists every rail it failed.
3. The usual causes:
   - the daily loss limit is empty
   - the trade risks more than the per-trade limit
   - the prices are older than your limit (delayed data counts as 15 minutes old)

### A bot didn't trade
1. Open **Today**.
2. Read the bot's line:
   - "no trade" with a reason (VIX range, no setup, a skipped day, a position still open)
   - or "the bot may not have run in time", meaning the bot wasn't running at its entry time

### Supabase says the project is paused
1. Sign in at supabase.com.
2. Open the `stockwizard` project.
3. Click **Restore**. Nothing is lost. The keep-awake job normally prevents this.

## Checking it still works

The automated checks run on every pull request:

- the Python tests (indicators, rules, backtests, bot, safety rails)
- the app's tests
- the built app in a headless browser
- the database security rules on a local copy

None of them uses real market data, the live database, Interactive Brokers
or a phone. Those are checked by using the app.

## Changes

What changed, and when: [CHANGELOG.md](../CHANGELOG.md).

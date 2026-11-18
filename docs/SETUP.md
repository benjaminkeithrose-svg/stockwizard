# Setting up Stock Wizard on your PC

Stock Wizard is by invitation. You use the app for charts, scans, backtests
and your own paper trades; the market data is shared. Its trading runs on your
own Windows PC, next to Interactive Brokers' trading program, and only ever
trades your Interactive Brokers **paper** account (practice money). It
refuses live accounts.

You do steps 1 to 10 once. After that Stock Wizard starts by itself when you
sign in to Windows.

## Stock Wizard

### 1. Accept the invitation
1. Open the invitation email from Stock Wizard (it comes from Supabase).
2. Click the link in it. Stock Wizard opens in your browser.
3. Type a password (at least 8 characters) and click **Set my password**.

From now on, sign in at https://benjaminkeithrose-svg.github.io/stockwizard/
with your email and that password.

### 2. Set your limits
1. In Stock Wizard, click **Menu** at the top right.
2. Click **Safety and orders**.
3. Under **Limits**, click the card, set each limit, and click **Done**.
   Until there's a daily loss limit, every order is refused.

### 3. Make your access key
1. Click **Menu** at the top right, then **Access key**.
2. Click **Make an access key**.
3. Click **Copy the key**, and keep the page open: the key is shown only once.

## Interactive Brokers

### 4. Get a paper trading account
1. You need an Interactive Brokers account. Every account comes with a paper
   trading account.
2. Sign in to Interactive Brokers' Client Portal in your browser.
3. Click the person icon at the top right, then **Settings**.
4. Under **Account Settings**, find **Paper Trading Account** and follow the
   steps. Note the paper **username** it gives you.

### 5. Install TWS
1. On Interactive Brokers' website, search for **Trader Workstation (TWS)**.
2. Download **TWS Stable** for Windows.
3. Open the downloaded file and click through the installer.

### 6. Log in to paper trading
1. Open **Trader Workstation** from the Start menu.
2. Choose **Paper Trading** at the top of the login window.
3. Type your paper username and password, then click **Log In**.

### 7. Turn on TWS's connection for Stock Wizard
1. In TWS, click **File**, then **Global Configuration**.
2. On the left, click **API**, then **Settings**.
3. Tick **Enable ActiveX and Socket Clients**.
4. Untick **Read-Only API**.
5. Check **Socket port** says **7497**. Type 7497 if it doesn't.
6. Tick **Allow connections from localhost only**.
7. Click **Apply**, then **OK**.

### 8. Real-time prices (optional)
Without a market data subscription, Interactive Brokers sends prices about
15 minutes late, and Stock Wizard treats them as old. To share your subscriptions
with the paper account:
1. In Client Portal, click the person icon, then **Settings**.
2. Find **Paper Trading Account** and set **Share real-time market data** to
   **Yes**.
3. Log out of TWS and back in to Paper Trading.

## Stock Wizard on your PC

### 9. Install it
1. Download **StockWizardSetup.exe** from
   https://github.com/benjaminkeithrose-svg/stockwizard/releases/latest
   (under **Assets**).
2. Double-click it.
3. If Windows says **Windows protected your PC**, click **More info**, then
   **Run anyway**. (The installer isn't signed with a paid certificate.)
4. Click **Next**. Paste your access key from step 3 and click **Next**.
5. Choose **TWS (Trader Workstation): paper port 7497** and click **Next**.
6. Tick the box only if you skipped step 8, then click **Next**.
7. Leave **Start Stock Wizard when I sign in to Windows** ticked. Click
   **Install**.
8. Leave **Open Stock Wizard now** ticked and click **Finish**.

No administrator rights are needed, and it installs nothing else.

### 10. Check it's connected
1. Stock Wizard opens in its own window, and an **S** in a circle appears by
   the clock (click the small **^** arrow if you can't see it).
2. With TWS logged in to Paper Trading, the circle turns **green** within a
   minute. Amber means it's waiting for TWS; red means it stopped.
3. In the app, the line under the header says **PC: trading connected**.
4. Closing the window is fine: trading keeps running behind the icon.
   **Quit** on the icon stops it.

## Each day
- Keep the PC on and awake through the US session (overnight in Australia),
  with TWS logged in to **Paper Trading**. To stop the PC sleeping: Start,
  **Power & sleep settings**, set **When plugged in, PC goes to sleep after**
  to **Never**.
- TWS restarts once a day and may ask you to log in again. Stock Wizard waits,
  then reconnects by itself and checks its orders against Interactive Brokers
  before trading again.
- Close TWS with **File**, then **Exit**, so it keeps its settings.
- Orders, approvals and the kill switch are in the app: **Menu**, **Safety
  and orders**.

## Changing things
- **Settings**: right-click the icon by the clock, then **Settings** (or
  Start menu, **Stock Wizard settings**). Change what you need and click
  **Done**: Stock Wizard restarts trading with the new settings.
- **A new access key**: make it in the app (step 3) and paste it in Settings.
  The old key stops working.
- **Phone notifications** (optional): install the free **ntfy** app,
  subscribe to a hard-to-guess topic name, and type that name in Settings.
- **Updating**: when a new version is ready, a notice pops up by the clock.
  Right-click the icon and click **Update to …**. Stock Wizard closes,
  updates and opens again by itself, keeping your settings. It won't update
  during the US session.
- **Logs**: right-click the icon, then **Logs**.
- **Removing it**: Windows **Settings**, **Apps**, **Stock Wizard**,
  **Uninstall**.

## If something's wrong
| You see | What to do |
|---|---|
| Amber icon, or "TWS isn't taking connections" | TWS isn't running, isn't logged in, or its API is off: steps 6 and 7. Stock Wizard tries again every minute. Check Settings says TWS (port 7497). |
| "isn't a paper account" | TWS is logged in to your live account. Log out and choose **Paper Trading**. |
| "The access key was refused" | The key was replaced. Make a new one (step 3) and paste it in Settings. |
| It asks for a key when it opens | Its settings are missing: paste your access key in the Settings window. |
| "Port 7496 is a live-trading port" | Settings say a live port. Choose **TWS (port 7497)** in Settings. |
| Something else | Right-click the icon, **Logs**, and send Ben the last lines of `bot.log`. |

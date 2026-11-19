# Setting up Stock Wizard on your PC

Stock Wizard is by invitation. You use the app for charts, scans, backtests
and your own paper trades; the market data is shared. Its trading runs on your
own Windows PC, next to Interactive Brokers' trading program, and only ever
trades your Interactive Brokers **paper** account (practice money). It
refuses live accounts.

You do steps 1 to 10 once (most take a minute). After that Stock Wizard starts by itself when you
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
2. Click **Safety and limits**.
3. Under **Limits**, click the card, set each limit, and click **Done**.
   Until there's a daily loss limit, every order is refused.

## Interactive Brokers

### 3. Get a paper trading account
1. You need an Interactive Brokers account. Every account comes with a paper
   trading account.
2. Sign in to Interactive Brokers' Client Portal in your browser.
3. Click the person icon at the top right, then **Settings**.
4. Under **Account Settings**, find **Paper Trading Account** and follow the
   steps. Note the paper **username** it gives you.

### 4. Install TWS
1. On Interactive Brokers' website, search for **Trader Workstation (TWS)**.
2. Download **TWS Stable** for Windows.
3. Open the downloaded file and click through the installer.

### 5. Log in to paper trading
1. Open **Trader Workstation** from the Start menu.
2. Choose **Paper Trading** at the top of the login window.
3. Type your paper username and password, then click **Log In**.

### 6. Turn on TWS's connection for Stock Wizard
1. In TWS, click **File**, then **Global Configuration**.
2. On the left, click **API**, then **Settings**.
3. Tick **Enable ActiveX and Socket Clients**.
4. Untick **Read-Only API**.
5. Check **Socket port** says **7497**. Type 7497 if it doesn't.
6. Tick **Allow connections from localhost only**.
7. Click **Apply**, then **OK**.

### 7. Real-time prices (optional)
Without a market data subscription, Interactive Brokers sends prices about
15 minutes late, and Stock Wizard treats them as old. To share your subscriptions
with the paper account:
1. In Client Portal, click the person icon, then **Settings**.
2. Find **Paper Trading Account** and set **Share real-time market data** to
   **Yes**.
3. Log out of TWS and back in to Paper Trading.

## Stock Wizard on your PC

### 8. Install it
1. Download **StockWizardSetup.exe** from
   https://github.com/benjaminkeithrose-svg/stockwizard/releases/latest
   (under **Assets**).
2. Double-click it.
3. If Windows says **Windows protected your PC**, click **More info**, then
   **Run anyway**. (The installer isn't signed with a paid certificate.)
4. Click through the installer: it asks nothing about your account. Leave
   **Start Stock Wizard when I sign in to Windows** and **Open Stock Wizard
   now** ticked, and click **Finish**.

No administrator rights are needed, and it installs nothing else.

### 9. Set it up inside Stock Wizard
1. Stock Wizard opens in its own window. Sign in with your email and
   password.
2. **Setup** opens by itself (later: **Menu**, then **Setup**). Each step can
   be skipped and done later.
3. **Connect**: click **Connect this PC**. It makes your access key and saves
   it on this PC. Nothing to copy or paste.
4. **TWS**: the same steps as step 6 above; click **Check the connection**.
5. **Prices**: choose **Delayed** if you skipped step 7. Type your ntfy topic
   if you want phone notifications.
6. **Screens** (several monitors): give each one a job (Main chart, Watch
   page or Trading) and Stock Wizard opens a window on each.
7. Click **Finish**.

### 10. Check it's connected
1. An **S** in a circle sits by the clock (click the small **^** arrow if you
   can't see it).
2. With TWS logged in to Paper Trading, the circle turns **green** within a
   minute. Amber means it's waiting for TWS or for Setup; red means it
   stopped.
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
- Orders and approvals are in the app under **Menu**, **Trading**; the kill
  switch and limits under **Menu**, **Safety and limits**.

## Changing things
- **Settings**: in Stock Wizard, **Menu**, then **Setup**. (The icon's
  **Settings** window still works too.)
- **A new access key**: Setup, **Connect**, **Connect again with a new key**.
  The old key stops working.
- **Phone notifications** (optional): install the free **ntfy** app,
  subscribe to a hard-to-guess topic name, and type that name in Setup,
  **Prices**.
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
| Amber icon, or "TWS isn't taking connections" | TWS isn't running, isn't logged in, or its API is off: steps 5 and 6. Stock Wizard tries again every minute. Check Settings says TWS (port 7497). |
| "isn't a paper account" | TWS is logged in to your live account. Log out and choose **Paper Trading**. |
| "The access key was refused" | The key was replaced. In Stock Wizard: Menu, Setup, Connect, **Connect again with a new key**. |
| Amber icon, "Not set up yet" | This PC isn't connected: in Stock Wizard, Menu, Setup, **Connect this PC**. |
| "Port 7496 is a live-trading port" | Settings say a live port. Choose **TWS (port 7497)** in Settings. |
| Something else | Right-click the icon, **Logs**, and send Ben the last lines of `bot.log`. |

# Setting up Stock Wizard and your own bot

Stock Wizard is by invitation. You use the app for charts, scans, backtests
and your own paper trades; the market data is shared. Your bot runs on your
own Windows PC, next to Interactive Brokers' trading program, and only ever
trades your Interactive Brokers **paper** account (practice money). It
refuses live accounts.

You do steps 1 to 10 once. After that the bot starts by itself when you sign
in to Windows.

## Stock Wizard

### 1. Accept the invitation
1. Open the invitation email from Stock Wizard (it comes from Supabase).
2. Click the link in it. Stock Wizard opens in your browser.
3. Type a password (at least 8 characters) and click **Set my password**.

From now on, sign in at https://benjaminkeithrose-svg.github.io/stockwizard/
with your email and that password.

### 2. Set your limits
1. In Stock Wizard, click the menu at the top right (three dots).
2. Click **Safety and orders**.
3. Under **Limits**, click the card, set each limit, and click **Done**.
   Until there's a daily loss limit, the bot refuses every order.

### 3. Make your bot key
1. Click the menu at the top right (three dots), then **Bot key**.
2. Click **Make a bot key**.
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

### 7. Turn on TWS's connection for the bot
1. In TWS, click **File**, then **Global Configuration**.
2. On the left, click **API**, then **Settings**.
3. Tick **Enable ActiveX and Socket Clients**.
4. Untick **Read-Only API**.
5. Check **Socket port** says **7497**. Type 7497 if it doesn't.
6. Tick **Allow connections from localhost only**.
7. Click **Apply**, then **OK**.

### 8. Real-time prices (optional)
Without a market data subscription, Interactive Brokers sends prices about
15 minutes late, and the bot treats them as old. To share your subscriptions
with the paper account:
1. In Client Portal, click the person icon, then **Settings**.
2. Find **Paper Trading Account** and set **Share real-time market data** to
   **Yes**.
3. Log out of TWS and back in to Paper Trading.

## The bot

### 9. Install it
1. Download **StockWizardBotSetup.exe** from
   https://github.com/benjaminkeithrose-svg/stockwizard/releases/latest
2. Double-click it.
3. If Windows says **Windows protected your PC**, click **More info**, then
   **Run anyway**. (The installer isn't signed with a paid certificate.)
4. Click **Next**. Paste your bot key from step 3 and click **Next**.
5. Choose **TWS (Trader Workstation)** and click **Next**.
6. Tick the box only if you skipped step 8, then click **Next**.
7. Leave **Start the bot when I sign in to Windows** ticked. Click **Install**.
8. Leave **Start the bot now** ticked and click **Finish**.

No administrator rights are needed, and it installs nothing else.

### 10. Check it's connected
1. A window called **Stock Wizard bot** opens.
2. With TWS logged in to Paper Trading, it says **Connected to Interactive
   Brokers, paper account DU…** within a minute. Paper account numbers start DU.
3. Leave the window open. Minimised is fine.

## Each day
- Keep the PC on and awake through the US session (overnight in Australia),
  with TWS logged in to **Paper Trading**.
- TWS restarts once a day and may ask you to log in again. The bot waits, then
  reconnects by itself and checks its orders against Interactive Brokers
  before trading again.
- Close TWS with **File**, then **Exit**, so it keeps its settings.
- Orders, approvals and the kill switch are in the app: menu, **Safety and
  orders**.

## Changing things
- **Settings**: Start menu, **Stock Wizard Bot settings**. Change a line, save,
  then close the bot's window and open **Stock Wizard Bot** from the Start menu.
- **A new bot key**: make it in the app (step 3), then put it in the settings
  on the **BOT_KEY=** line, with no spaces. The old key stops working.
- **Phone notifications** (optional): install the free **ntfy** app, subscribe
  to a hard-to-guess topic name, and add a line **NTFY_TOPIC=** with that name
  to the settings.
- **Updating**: close the bot's window, download the latest installer (step 9),
  run it, and leave the bot key empty to keep yours.
- **Removing it**: Windows **Settings**, **Apps**, **Stock Wizard Bot**,
  **Uninstall**.

## If something's wrong
| The bot says | What to do |
|---|---|
| API connection failed, or connection refused | TWS isn't running or isn't logged in, or its API is off: steps 6 and 7. The bot tries again every minute. |
| isn't a paper account | TWS is logged in to your live account. Log out and choose **Paper Trading**. |
| The bot key was refused | The key was replaced. Make a new one (step 3) and put it in the settings. |
| The bot's settings are missing | Run the installer again and paste your bot key. |
| Port 7496 is a live-trading port | The settings say 7496. Change **IB_PORT=** to **7497**. |

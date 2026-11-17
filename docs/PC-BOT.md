# Running the paper bot on your PC

The bot runs on your PC next to IB Gateway, Interactive Brokers' small
program that keeps you logged in. US markets are open overnight in Sydney
(about 1:30 am to 8 am in summer), so the PC stays on through the night on
market days.

It only ever trades your **paper** account. It refuses live ports and any
account whose number doesn't start with "DU" (paper account numbers do).

You do steps 1 to 6 once. After that it's step 7, plus approving IB
Gateway's login on your phone when it asks.

## One-time set-up

### 1. Install Python
1. Open https://www.python.org/downloads/ in your browser.
2. Click **Download Python** (the yellow button).
3. Open the downloaded file.
4. Tick **Add python.exe to PATH** at the bottom of the first screen.
5. Click **Install Now**, then **Close** when it finishes.

### 2. Install IB Gateway
1. Open https://www.interactivebrokers.com.au/ and search the site for **IB Gateway**.
2. Download **IB Gateway Stable** for Windows.
3. Open the downloaded file and click through the installer.

### 3. Log in to IB Gateway (paper)
1. Open **IB Gateway** from the Start menu.
2. Choose **IB API** at the top (not FIX CTCI).
3. Choose **Paper Trading**.
4. Type your paper username and password, then click **Log In**.
5. Approve the login in the **IBKR Mobile** app on your phone if it asks.

### 4. Turn on the API in IB Gateway
1. In IB Gateway, click **Configure**, then **Settings**.
2. Click **API**, then **Settings**.
3. Tick **Enable ActiveX and Socket Clients**.
4. Untick **Read-Only API**.
5. Check **Socket port** says **4002**. Type 4002 if it doesn't.
6. Under **Trusted IPs**, check **127.0.0.1** is listed. If not, click **Create** and type 127.0.0.1.
7. Click **OK**.

### 5. Get the Stock Wizard folder and its key
1. On the repository's GitHub page, click the green **Code** button, then **Download ZIP**.
2. Right-click the downloaded ZIP, click **Extract All**, and extract it to `C:\StockWizard`.
3. Open `C:\StockWizard\stockwizard-main\pc` in File Explorer.
4. Right-click an empty spot, click **New**, then **Text Document**, and name it `stockwizard.env`. Click **Yes** when Windows asks about changing the extension.
5. Open it in Notepad and type these two lines, replacing the second part of the second line with your secret key (Supabase, Project Settings, API Keys, the `sb_secret_` key, the same one you put in GitHub):

   ```
   SUPABASE_URL=https://cxpspihahmztfydvdwpd.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_your-key-here
   ```

6. Save and close Notepad.

This file stays on your PC. It isn't in the repository and never should be.

### 6. Keep the PC awake overnight
1. Click **Start**, type **Power, sleep and battery**, and open it.
2. Under **Screen and sleep**, set **When plugged in, put my device to sleep after** to **Never**.
3. Leave the screen-off setting as it is; a dark screen is fine.

## Each time you want the bot running

### 7. Start it
1. Open IB Gateway and log in to **Paper Trading** (step 3).
2. Double-click `start-bot.bat` in the `pc` folder.
3. The first time, it sets itself up for a few minutes. Then it says **Connected to Interactive Brokers, paper account DU…**.
4. Leave the window open. Orders, approvals and the kill switch work from the app's **Safety and orders** screen as before.

To stop the bot, close its window. The kill switch in the app also stops all trading straight away.

## Good to know

- **IB Gateway restarts once a day** and sometimes asks you to log in again, with the confirmation on your phone. While it's down, the bot stops trading. When it's back, the bot checks its orders and positions against Interactive Brokers before doing anything else. If they don't match, it stays stopped and says why.
- **Market data:** quotes need an options data subscription. Without one, add `--delayed` to the line in `start-bot.bat`. Delayed quotes count as 15 minutes old, so the stale-data limit refuses every order until you subscribe. That's on purpose.
- **Updating:** download the ZIP again (step 5) into a new folder and copy your `stockwizard.env` across.
- Once this runs reliably, I'll turn off the GitHub schedule that runs the pretend-broker bot.

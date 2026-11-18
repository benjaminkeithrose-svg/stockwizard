@echo off
rem Stock Wizard paper bot, on Ben's PC, with IB Gateway (paper) running.
rem Double-click to start. Close this window to stop the bot.
rem The first run sets up Python's packages (a few minutes); later runs start straight away.
rem Keys come from stockwizard.env next to this file, which is never committed.

setlocal
cd /d "%~dp0"

if not exist stockwizard.env (
  echo.
  echo stockwizard.env is missing. Follow step 5 in docs\PC-BOT.md to make it, then double-click this again.
  pause
  exit /b 1
)
for /f "usebackq tokens=1,* delims==" %%a in ("stockwizard.env") do set "%%a=%%b"
rem IB Gateway paper is 4002 (the default). With TWS instead, add IB_PORT=7497 to stockwizard.env.
if not defined IB_PORT set "IB_PORT=4002"
rem No options data subscription: add IB_DELAYED=1 to stockwizard.env. Quotes then count as 15 minutes
rem old, so raise "Oldest prices allowed" in the app's Safety screen (about 1200 seconds) or every order is refused.
set "DELAYED="
if /i "%IB_DELAYED%"=="1" set "DELAYED=--delayed"
if /i "%IB_DELAYED%"=="yes" set "DELAYED=--delayed"
if /i "%IB_DELAYED%"=="true" set "DELAYED=--delayed"

if not exist .venv (
  echo Setting up the first time...
  py -3 -m venv .venv || (echo Python isn't installed: see step 1 in docs\PC-BOT.md & pause & exit /b 1)
  .venv\Scripts\python -m pip install --quiet --upgrade pip
  .venv\Scripts\python -m pip install --quiet -e "..\backend[ibkr]" || (echo Couldn't install the bot's packages. & pause & exit /b 1)
)

echo.
echo Stock Wizard paper bot. Paper account only; live trading is refused.
echo It checks every 30 seconds. Leave this window open.
if defined DELAYED echo Delayed market data: quotes count as 15 minutes old.
echo.
:run
.venv\Scripts\python -m stockwizard.run_bot --broker ibkr --port %IB_PORT% %DELAYED% --loop 30
echo.
echo The bot stopped. It starts again in 60 seconds (close this window to stop it for good).
timeout /t 60
goto run

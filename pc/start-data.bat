@echo off
rem Stock Wizard data, on Ben's PC, with TWS or IB Gateway (paper) running.
rem Fetches candles from Interactive Brokers into the archive (pc\data\archive.sqlite)
rem and the recent window into Supabase for the app; after each US close it adds the
rem day's candles, runs the scans and backs the archive up to OneDrive\StockWizard.
rem Read-only connection: it can't place orders. Runs beside start-bot.bat.
rem Double-click to start. Close this window to stop it.

setlocal
cd /d "%~dp0"

if not exist stockwizard.env (
  echo.
  echo stockwizard.env is missing. Follow step 5 in docs\PC-BOT.md to make it, then double-click this again.
  pause
  exit /b 1
)
for /f "usebackq tokens=1,* delims==" %%a in ("stockwizard.env") do set "%%a=%%b"
if not defined IB_PORT set "IB_PORT=4002"

if not exist .venv (
  echo Setting up the first time...
  py -3 -m venv .venv || (echo Python isn't installed: see step 1 in docs\PC-BOT.md & pause & exit /b 1)
  .venv\Scripts\python -m pip install --quiet --upgrade pip
  .venv\Scripts\python -m pip install --quiet -e "..\backend[ibkr]" || (echo Couldn't install the packages. & pause & exit /b 1)
)

echo.
echo Stock Wizard data from Interactive Brokers. The first run fetches years of history (a few minutes).
echo Leave this window open.
echo.
:run
.venv\Scripts\python -m stockwizard.run_data --port %IB_PORT%
echo.
echo The data program stopped. It starts again in 60 seconds (close this window to stop it for good).
timeout /t 60
goto run

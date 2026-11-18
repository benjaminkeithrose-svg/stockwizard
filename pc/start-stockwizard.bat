@echo off
rem Stock Wizard on Ben's PC: the app in its own window, with the bot and the data program
rem running behind its icon by the clock (stockwizard.supervisor). Replaces start-bot.bat
rem and start-data.bat: don't run those as well, or two bots would share one TWS. Already
rem running? This just brings its window forward. Quit from the icon stops everything.
rem Settings: the icon's Settings (stockwizard.env next to this file; RUN_DATA=1 runs the
rem data program, STOCKWIZARD_OWNER is your user id). Logs: the logs folder next to this file.

setlocal
cd /d "%~dp0"
if not exist stockwizard.env (
  echo stockwizard.env is missing. Follow step 5 in docs\PC-BOT.md to make it, then double-click this again.
  pause
  exit /b 1
)
if not exist .venv (
  echo Setting up the first time...
  py -3 -m venv .venv || (echo Python isn't installed: see step 1 in docs\PC-BOT.md & pause & exit /b 1)
  .venv\Scripts\python -m pip install --quiet --upgrade pip
)
.venv\Scripts\python -m pip install --quiet -e "..\backend[ibkr,pc]" || (echo Couldn't install the packages. & pause & exit /b 1)
start "" .venv\Scripts\pythonw.exe -m stockwizard.supervisor --settings "%~dp0stockwizard.env" --show

@echo off
rem Stock Wizard on Ben's PC: the bot and the data program under one supervisor, with an
rem icon by the clock (stockwizard.supervisor). Replaces start-bot.bat and start-data.bat:
rem don't run those as well, or two bots would share one TWS. Quit from the icon.
rem Settings: stockwizard.env next to this file (STOCKWIZARD_OWNER is needed now that
rem others have accounts). Logs: the logs folder next to this file.

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
start "" .venv\Scripts\pythonw.exe -m stockwizard.supervisor --settings "%~dp0stockwizard.env" --data

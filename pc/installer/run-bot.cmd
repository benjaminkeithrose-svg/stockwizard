@echo off
rem Stock Wizard bot, as installed by StockWizardBotSetup.exe. Started from the Start menu,
rem or when you sign in to Windows. Close this window to stop the bot.
rem Settings: %LOCALAPPDATA%\StockWizard\stockwizard.env (Start menu: Stock Wizard Bot settings).

setlocal
title Stock Wizard bot
cd /d "%~dp0"
set "CFG=%LOCALAPPDATA%\StockWizard\stockwizard.env"
if not exist "%CFG%" (
  echo.
  echo The bot's settings are missing. Run the Stock Wizard Bot installer again and paste your bot key.
  pause
  exit /b 1
)
for /f "usebackq tokens=1,* delims==" %%a in ("%CFG%") do set "%%a=%%b"
if not defined IB_PORT set "IB_PORT=7497"
set "DELAYED="
if /i "%IB_DELAYED%"=="1" set "DELAYED=--delayed"
if /i "%IB_DELAYED%"=="yes" set "DELAYED=--delayed"
if /i "%IB_DELAYED%"=="true" set "DELAYED=--delayed"

echo.
echo Stock Wizard bot. Paper account only; live trading is refused.
echo It needs TWS or IB Gateway running and logged in to Paper Trading (port %IB_PORT%).
if defined DELAYED echo Delayed market data: quotes count as 15 minutes old.
echo Leave this window open (minimised is fine).
echo.
:run
"%~dp0python\python.exe" -m stockwizard.run_bot --broker ibkr --port %IB_PORT% %DELAYED% --loop 30
echo.
echo The bot stopped (it restarts if TWS was closed or restarted). Starting again in 60 seconds.
echo Close this window to stop it for good.
timeout /t 60
goto run

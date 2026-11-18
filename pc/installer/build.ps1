# Builds dist\StockWizardBotSetup.exe: the bot with its own Python, for any Windows PC.
# Runs on GitHub (.github/workflows/installer.yml); also by hand, with Python 3.13 and
# Inno Setup 6 installed:  powershell -File pc\installer\build.ps1
#
# 1. Python's embeddable package (a small Python with no installer) from python.org.
# 2. The bot's packages into it, as ready-made Windows wheels.
# 3. backend\stockwizard and the launcher beside it.
# 4. Inno Setup compiles StockWizardBot.iss into the installer.

param(
  [string]$PythonVersion = "3.13.17",
  [string]$AppVersion = "0.1.0",
  [string]$Python = "python",
  [string]$Iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Resolve-Path "$here\..\.."
$build = Join-Path $here "build"
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force "$build\python", "$build\app" | Out-Null

# 1. Embeddable Python
$zip = Join-Path $env:TEMP "python-$PythonVersion-embed-amd64.zip"
if (-not (Test-Path $zip)) {
  Invoke-WebRequest "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip" -OutFile $zip -UseBasicParsing
}
Expand-Archive $zip -DestinationPath "$build\python" -Force
$short = ($PythonVersion -split '\.')[0..1] -join ''
# Where this Python looks for code: its own library, its packages, and the bot (..\app).
Set-Content -Encoding ascii "$build\python\python$short._pth" @"
python$short.zip
.
Lib\site-packages
..\app
import site
"@

# 2. The bot's packages (the same as backend/pyproject.toml's, plus Windows' time zones)
& $Python -m pip install --quiet --target "$build\python\Lib\site-packages" --platform win_amd64 `
  --python-version ($PythonVersion -replace '^(\d+\.\d+).*', '$1') --implementation cp --only-binary=:all: `
  "numpy>=1.26" "pandas>=2.1" "ib_async>=2.0" tzdata "pystray>=0.19" "Pillow>=10" "pywebview>=5"
if ($LASTEXITCODE) { throw "pip couldn't fetch the bot's packages" }

# 3. The bot and its launcher
Copy-Item -Recurse "$root\backend\stockwizard" "$build\app\stockwizard"
Get-ChildItem "$build\app" -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
Copy-Item "$here\run-bot.cmd" $build

# Check the bundled Python starts the bot's code before packing it.
& "$build\python\python.exe" -c "import stockwizard.run_bot, stockwizard.broker.ibkr, stockwizard.supervisor, stockwizard.pc_settings, ib_async, pandas, pystray, PIL, webview, zoneinfo; zoneinfo.ZoneInfo('America/New_York'); print('bundle ok')"
if ($LASTEXITCODE) { throw "The bundled Python can't load the bot" }

# 4. The installer
& $Iscc "/DSourceDir=$build" "/DAppVersion=$AppVersion" "$here\StockWizardBot.iss"
if ($LASTEXITCODE) { throw "Inno Setup failed" }
Get-Item "$root\dist\StockWizardBotSetup.exe" | ForEach-Object { "Built $($_.FullName) ({0:N1} MB)" -f ($_.Length / 1MB) }

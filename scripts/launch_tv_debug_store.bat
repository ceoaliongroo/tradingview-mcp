@echo off
setlocal enableextensions enabledelayedexpansion

set "PORT=%~1"
if "%PORT%"=="" set "PORT=9222"

set "TV_EXE=C:\Program Files\WindowsApps\31178TradingViewInc.TradingView_3.0.0.0_x64__q4jpyh43s5mv6\TradingView.exe"

if not defined TV_EXE (
  echo TradingView Store install not found.
  exit /b 1
)

if not exist "%TV_EXE%" (
  echo TradingView Store executable not found at:
  echo %TV_EXE%
  exit /b 1
)

echo Launching TradingView from: %TV_EXE%
start "" "%TV_EXE%" --remote-debugging-port=%PORT%

endlocal

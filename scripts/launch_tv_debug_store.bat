@echo off
setlocal enableextensions enabledelayedexpansion

set "PORT=%~1"
if "%PORT%"=="" set "PORT=9222"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pkg = Get-AppxPackage *TradingView* | Select-Object -First 1; " ^
  "if (-not $pkg) { throw 'TradingView Store package not found.' }; " ^
  "$exe = Join-Path $pkg.InstallLocation 'TradingView.exe'; " ^
  "Write-Output ('Launching TradingView from: ' + $exe); " ^
  "Invoke-CommandInDesktopPackage -PackageFamilyName $pkg.PackageFamilyName -AppId 'TradingView.Desktop' -Command $exe -Args '--remote-debugging-port=%PORT%'"

if errorlevel 1 exit /b %errorlevel%

endlocal

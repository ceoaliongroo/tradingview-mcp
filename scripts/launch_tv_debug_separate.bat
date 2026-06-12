@echo off
REM Launch a separate TradingView Desktop instance for MCP/debug work.
REM Unlike launch_tv_debug.bat, this does not kill existing TradingView windows.
REM Usage: scripts\launch_tv_debug_separate.bat [port]

set PORT=%1
if "%PORT%"=="" set PORT=9222

set "TV_EXE="

if exist "%LOCALAPPDATA%\TradingView\TradingView.exe" set "TV_EXE=%LOCALAPPDATA%\TradingView\TradingView.exe"
if exist "%PROGRAMFILES%\TradingView\TradingView.exe" set "TV_EXE=%PROGRAMFILES%\TradingView\TradingView.exe"
if exist "%PROGRAMFILES(x86)%\TradingView\TradingView.exe" set "TV_EXE=%PROGRAMFILES(x86)%\TradingView\TradingView.exe"

if "%TV_EXE%"=="" (
    for /f "tokens=*" %%i in ('where TradingView.exe 2^>nul') do set "TV_EXE=%%i"
)

if "%TV_EXE%"=="" (
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$pkg = Get-AppxPackage *TradingView* | Select-Object -First 1; if ($pkg) { $exe = Join-Path $pkg.InstallLocation 'TradingView.exe'; if (Test-Path $exe) { $exe } }"`) do set "TV_EXE=%%i"
)

if "%TV_EXE%"=="" (
    echo Error: TradingView not found.
    echo If installed elsewhere, run manually:
    echo   "C:\path\to\TradingView.exe" --remote-debugging-port=%PORT% --user-data-dir="%%LOCALAPPDATA%%\TradingView-MCP-DebugProfile"
    echo.
    pause
    exit /b 1
)

set "DEBUG_PROFILE=%LOCALAPPDATA%\TradingView-MCP-DebugProfile"

echo Found TradingView at: %TV_EXE%
echo Starting separate MCP/debug profile at: %DEBUG_PROFILE%
echo CDP port: %PORT%

powershell -NoProfile -Command "$pkg = Get-AppxPackage *TradingView* | Select-Object -First 1; if ($pkg -and '%TV_EXE%' -like '*\WindowsApps\*') { Invoke-CommandInDesktopPackage -PackageFamilyName $pkg.PackageFamilyName -AppId 'TradingView.Desktop' -Command '%TV_EXE%' -Args '--remote-debugging-port=%PORT% --user-data-dir=\"%DEBUG_PROFILE%\"' } else { Start-Process -FilePath '%TV_EXE%' -ArgumentList '--remote-debugging-port=%PORT%', '--user-data-dir=\"%DEBUG_PROFILE%\"' }"
if %errorlevel% neq 0 (
    echo.
    echo Error: failed to start TradingView.
    pause
    exit /b 1
)

echo.
echo Waiting for CDP to become available...
timeout /t 5 /nobreak >nul

:check
curl -s http://localhost:%PORT%/json/version >nul 2>&1
if %errorlevel% neq 0 (
    echo Still waiting...
    timeout /t 2 /nobreak >nul
    goto check
)

echo.
echo CDP ready at http://localhost:%PORT%
curl -s http://localhost:%PORT%/json/version
echo.
echo You can leave this terminal open while using Codex MCP.
pause

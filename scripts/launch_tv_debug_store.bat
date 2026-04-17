@echo off
setlocal enableextensions

set "PORT=%~1"
if "%PORT%"=="" set "PORT=9222"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_tv_debug_store.ps1" -Port "%PORT%"
if errorlevel 1 exit /b 1

endlocal

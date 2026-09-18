@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
if errorlevel 1 if not "%WEB_REVISION_NO_PAUSE%"=="1" pause

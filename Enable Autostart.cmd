@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" -Action Install
if errorlevel 1 pause

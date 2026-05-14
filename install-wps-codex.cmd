@echo off
setlocal
cd /d "%~dp0"
powershell.exe -ExecutionPolicy Bypass -File "%~dp0scripts\install-wps-codex.ps1"

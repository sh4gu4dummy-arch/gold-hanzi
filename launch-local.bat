@echo off
REM Offline local launcher for gold-hanzi.
REM Port 8045 — do not use 8080 (another game already uses that).
REM Usage: launch-local.bat   →  http://127.0.0.1:8045/
cd /d "%~dp0"
python launch-local.py
if errorlevel 1 python3 launch-local.py

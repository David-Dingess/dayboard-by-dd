@echo off
REM Run BY HAND, once (and again when the poll says the session expired). This is
REM interactive — Amazon prompts for the OTP / 2SV code on the console. Uses the
REM venv if present, otherwise the system Python (needs `pip install amazon-orders`).
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" login.py
) else (
  python login.py
)
pause

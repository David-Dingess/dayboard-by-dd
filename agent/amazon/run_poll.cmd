@echo off
REM What Task Scheduler calls. Reuses the session login.py established and writes
REM data/packages.json. If the session has expired it exits 3 without prompting;
REM run run_login.cmd by hand to sign in again. Uses the venv if present,
REM otherwise the system Python (which needs `pip install amazon-orders`).
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" poll.py
) else (
  python poll.py
)
exit /b %ERRORLEVEL%

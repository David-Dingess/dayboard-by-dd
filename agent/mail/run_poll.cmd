@echo off
REM What Task Scheduler calls. Uses the venv if one was made, otherwise the
REM system Python — mail needs only stdlib plus python-dotenv, so a venv is
REM optional here.
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" poll.py
) else (
  python poll.py
)
exit /b %ERRORLEVEL%

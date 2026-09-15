<#
  The window, as the dayboard-board scheduled task opens it.

  Waits for the server rather than sleeping a guessed number of seconds, then
  opens Chrome once. Independent of dayboard-server on purpose: restarting the
  server must never spawn a second board window, and Task Scheduler has no notion
  of task dependencies, so nothing can cascade here by accident.
#>
$ErrorActionPreference = 'Continue'

. "$PSScriptRoot\_common.ps1"

# Already open? Then this is a second logon event or a manual /Run, and the right
# answer is to do nothing.
#
# GUARD ON THE WINDOW TITLE, NOT THE PROCESS LIST. A second launch against the
# same --user-data-dir hands the URL to the browser already using it and exits
# immediately, so the process that actually owns the window is not the one whose
# command line carries --app= — matching on that finds nothing. A visible window
# with the right title is the thing worth checking anyway, since that is the
# question being asked. The title comes from src/app/layout.tsx.
if (Get-Process chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq 'Dayboard' }) {
  exit 0
}

$chrome = Get-DayboardChrome
if (-not $chrome) {
  Write-DayboardLog 'Chrome not found — cannot open the board window'
  exit 1
}

$deadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $deadline) {
  if (Test-DayboardUp $DayboardPort) { break }
  Start-Sleep -Milliseconds 500
}

# Past the deadline it opens anyway. Chrome's own error page on the board is a
# better diagnostic than a bare desktop, and one refresh fixes it the moment the
# server lands.
Start-Process $chrome -ArgumentList $DayboardChromeArgs

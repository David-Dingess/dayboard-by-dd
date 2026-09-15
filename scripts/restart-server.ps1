<#
  Restarting the board's server. The one correct ordering, in one place —
  the reset button on the board calls this, and so does npm run deploy.

  It fixes two things that a naive End-sleep-Run gets wrong:

  1. `schtasks /End` STOPS THE TASK'S OWN PROCESS AND NOT NECESSARILY ITS
     CHILDREN. Microsoft's own reference for /end points you at TaskKill for
     anything the task started. An orphaned node keeps the port, and because
     `next start` exits on EADDRINUSE rather than sliding to the next port, the
     restarted task would die instantly and silently. So the port is treated as
     the truth, not the task's state.

  2. `schtasks /Run` IS SILENTLY IGNORED WHILE THE TASK STILL READS Running.
     With MultipleInstances = IgnoreNew — which is what we want, so a stray /Run
     cannot start a second server — a fixed one-second sleep is a coin flip. Lose
     it and the board never comes back, with nothing in any log to say why. This
     waits on the actual state instead.

  Kept deliberately: the opening pause. resetBoard spawns this detached
  precisely because restarting the task kills the process serving the response,
  so the response needs a moment to reach the browser first.
#>
param(
  [string]$Task = 'dayboard-server',
  [switch]$Quiet
)

$ErrorActionPreference = 'Continue'

. "$PSScriptRoot\_common.ps1"

if (-not $Quiet) { Start-Sleep -Milliseconds 700 }

schtasks /End /TN $Task 2>&1 | Out-Null

# Orphans first, then the port: a supervisor left alive would simply restart the
# server again the moment we cleared it.
Stop-DayboardSupervisors
Clear-DayboardPort $DayboardPort | Out-Null

# Wait for Task Scheduler to actually let go. Get-ScheduledTask is used rather
# than parsing `schtasks /Query` because the latter's output is localised and the
# word "Running" is not dependable.
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  $state = (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue).State
  if ($state -ne 'Running') { break }
  Start-Sleep -Milliseconds 300
}

schtasks /Run /TN $Task 2>&1 | Out-Null

# The browser gives up at 60 seconds, so stay well inside that before shoving it
# a second time.
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  if (Test-DayboardUp $DayboardPort) { exit 0 }
  Start-Sleep -Milliseconds 500
}

Write-DayboardLog 'restart: server did not answer within 40s — trying /Run once more'
schtasks /Run /TN $Task 2>&1 | Out-Null
exit 1

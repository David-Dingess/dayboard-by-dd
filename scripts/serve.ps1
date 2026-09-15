<#
  The board's server, as the dayboard-server scheduled task runs it.

  WHY NOT `npm run start`. On Windows npm expands to
  cmd.exe -> node(npm-cli) -> cmd.exe -> node(bin/next): five processes, two of
  them cmd.exe, which does not pass a kill down to its child. That is an orphan
  factory, and an orphan here holds the port. `node bin/next start` is exactly
  what npm ends up running, minus the middlemen — `next start` runs the server
  in-process, so this script's node IS the board.

  WHY IT RECLAIMS THE PORT BEFORE BINDING. `next start` does not slide to the
  next free port the way `next dev` does; the retry in start-server.js is gated
  on isDev, so a taken port is process.exit(1). One orphan and the board is dark
  until somebody notices. Clearing it first turns that into a log line.

  WHY IT LOOPS. This is what NSSM would have been, in a dozen lines: a crash
  comes back, but a crash LOOP gives up and says so rather than writing a
  gigabyte of EADDRINUSE to the log.
#>

# 'Stop' would be actively wrong here. In Windows PowerShell 5.1 a native
# command's stderr arrives as ErrorRecords, so the first ordinary warning Next
# writes would terminate the supervisor.
$ErrorActionPreference = 'Continue'

# Next writes UTF-8; PowerShell 5.1 decodes a native command's output as the OEM
# codepage unless told otherwise, which turns its tick and arrow glyphs into
# mojibake in the log. Cosmetic, but the log is read at 3am.
[Console]::OutputEncoding = [Text.Encoding]::UTF8

. "$PSScriptRoot\_common.ps1"

# Every data path is process.cwd()/data. Started anywhere else the board
# renders empty and blames nothing.
Set-Location $DayboardRepo

$maxLog = 5MB
$node = Get-DayboardNode
$nextBin = Join-Path $DayboardRepo 'node_modules\next\dist\bin\next'

function Update-LogSize {
  if ((Test-Path $DayboardLog) -and (Get-Item $DayboardLog).Length -gt $maxLog) {
    Move-Item $DayboardLog "$DayboardLog.1" -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path $nextBin)) {
  Write-DayboardLog "next is not installed — run npm ci in $DayboardRepo"
  exit 1
}
if (-not (Test-Path (Join-Path $DayboardRepo '.next\BUILD_ID'))) {
  Write-DayboardLog "no .next\BUILD_ID — run: npm run deploy"
  exit 1
}

<#
  ONLY ONE SUPERVISOR, ENFORCED HERE RATHER THAN HOPED FOR.

  Two of these running at once do not merely duplicate work, they fight to a
  standstill: each loop begins by taking the port, so A kills B's server, B's
  loop wakes and kills A's, forever, about every six seconds. The board serves
  Internal Server Error the whole time and the log looks like a crash loop in the
  app, which it is not.

  MultipleInstances = IgnoreNew stops Task Scheduler starting a second one, but
  it cannot see a supervisor orphaned by an earlier registration — and
  re-registering the task is exactly the moment one gets orphaned, because
  ending a task does not reliably take its children with it. So the guard has to
  live in the process itself. A named mutex is the cheapest guard that survives
  being orphaned, because it dies with the process holding it.

  Local\, not Global\. A Global\ mutex needs SeCreateGlobalPrivilege, which this
  task deliberately does not have — and the failure is the worst kind, because
  creating it throws, execution carries on with $ErrorActionPreference =
  'Continue', and the guard silently is not there. Local\ is per-session, and
  every copy of this runs in your session, so it is the right scope anyway.
#>
$mutex = $null
try {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\dayboard-server')
  $mine = $mutex.WaitOne(0)
} catch {
  Write-DayboardLog "could not take the single-instance lock: $($_.Exception.Message)"
  exit 1
}
if (-not $mine) {
  Write-DayboardLog 'another supervisor already owns this board — exiting rather than fighting it for the port'
  exit 0
}
Write-DayboardLog "supervisor $PID has the lock"

$fastFails = 0
while ($true) {
  if (-not (Clear-DayboardPort $DayboardPort)) { exit 1 }

  Update-LogSize
  Write-DayboardLog "starting: next start -p $DayboardPort -H 127.0.0.1"
  $began = Get-Date
  $lines = 0

  # -H 127.0.0.1, not 0.0.0.0. Loopback-only never triggers the Windows Firewall
  # prompt, which would otherwise appear at logon as a modal dialog ON TOP OF the
  # fullscreen board, waiting for a click that may never come. It also means the
  # host check in todoGate is a second line of defence rather than the only one,
  # and that the calendar, notes and mail are not readable from the LAN —
  # nothing guards reads.
  & $node $nextBin start -p $DayboardPort -H 127.0.0.1 2>&1 | ForEach-Object {
    if ((++$lines % 200) -eq 0) { Update-LogSize }
    # "$_" stringifies an ErrorRecord down to its message, so stderr lands clean
    # instead of dragging its CategoryInfo block along.
    Add-Content -Path $DayboardLog -Encoding utf8 `
      -Value ("{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), "$_")
  }

  $code = $LASTEXITCODE
  $lived = ((Get-Date) - $began).TotalSeconds
  Write-DayboardLog ("next exited {0} after {1:n0}s" -f $code, $lived)

  if ($lived -lt 20) { $fastFails++ } else { $fastFails = 0 }
  if ($fastFails -ge 5) {
    Write-DayboardLog 'five fast failures in a row — stopping rather than looping'
    exit 1
  }
  Start-Sleep -Seconds ([Math]::Min(30, 2 * $fastFails))
}

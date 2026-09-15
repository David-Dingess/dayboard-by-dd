<#
  Rebuild the board and put it back up. `npm run deploy`.

  This is the whole cost of running a production build instead of a dev server:
  code changes need one command before the board sees them. Data changes do not —
  events, to-dos, health and notes are read off disk uncached on every render, so
  `npm run event -- add ...` still reaches the screen within 30 seconds with
  nothing restarted.

  ORDER IS STOP -> VALIDATE -> BUILD -> START, and the stop comes first for a
  concrete reason. `next build` rewrites BUILD_ID and .next/static/<id>/, so a
  server still serving out of that directory starts 404ing its own chunks; on
  Windows the build can also fail outright on a file the running process holds
  open. Building under a live server is not a race worth having.

  The wall picks the new build up on its own: AutoRefresh fires router.refresh()
  every 30 seconds, and Next hard-reloads by itself if a chunk has gone missing.
#>
param(
  [switch]$SkipBuild,
  [switch]$SkipValidate
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_common.ps1"

Set-Location $DayboardRepo

$task = 'dayboard-server'
$node = Get-DayboardNode
$nextBin = Join-Path $DayboardRepo 'node_modules\next\dist\bin\next'
$installed = $null -ne (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)

if ($installed) {
  Write-Host 'Stopping the board server...' -ForegroundColor Cyan
  schtasks /End /TN $task 2>&1 | Out-Null
  Stop-DayboardSupervisors
  Clear-DayboardPort $DayboardPort | Out-Null
} else {
  Write-Host "No $task task registered — building only." -ForegroundColor Yellow
}

if (-not $SkipValidate) {
  # Cheap, and a bad layer file is a far more common break than a bad component.
  Write-Host 'Validating data...' -ForegroundColor Cyan
  & npm run validate
  if ($LASTEXITCODE -ne 0) { throw 'Data validation failed — nothing was rebuilt.' }
}

if (-not $SkipBuild) {
  Write-Host 'Building...' -ForegroundColor Cyan
  & $node $nextBin build
  if ($LASTEXITCODE -ne 0) {
    throw ".next is now half-written and the server is down. Fix the build and run npm run deploy again."
  }

  # The Sports tab's window keeper (agent/stream). dist/ is gitignored like the
  # other agents', so this is the only thing that ever builds it — and it runs
  # as a child of the server, so the server being stopped above is also what
  # frees its exe to be overwritten. Skipped when nothing in it has changed.
  $streamDir = Join-Path $DayboardRepo 'agent\stream'
  $streamExe = Join-Path $streamDir 'dist\dayboard-stream.exe'
  $newest = Get-ChildItem $streamDir -File -Include *.cs, *.csproj -Recurse |
    Where-Object { $_.FullName -notmatch '\\(bin|obj|dist)\\' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not (Test-Path $streamExe) -or ($newest -and $newest.LastWriteTime -gt (Get-Item $streamExe).LastWriteTime)) {
    Write-Host 'Building the stream helper...' -ForegroundColor Cyan
    Get-Process dayboard-stream -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    Push-Location $streamDir
    try {
      & dotnet publish -c Release -o dist --nologo -v quiet
      if ($LASTEXITCODE -ne 0) { Write-Warning 'The stream helper did not build. The board is fine; the Sports tab cannot open streams until it does.' }
    } finally {
      Pop-Location
    }
  }
}

if (-not $installed) {
  Write-Host 'Built. Register the tasks with scripts\setup.ps1 to run it.' -ForegroundColor Green
  exit 0
}

Write-Host 'Starting...' -ForegroundColor Cyan
schtasks /Run /TN $task 2>&1 | Out-Null

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  if (Test-DayboardUp $DayboardPort) {
    Write-Host ''
    Write-Host "Board is up on $DayboardUrl" -ForegroundColor Green
    Write-Host 'The window picks up the new build on its own within 30s.'
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

throw "Server did not answer within 90s — see $DayboardLog"

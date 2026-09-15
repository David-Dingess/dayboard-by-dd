<#
  Everything the board's PowerShell scripts agree on. Dot-source it:

      . "$PSScriptRoot\_common.ps1"

  IT EXISTS BECAUSE THESE VALUES DRIFTED ONCE AND IT WAS HORRIBLE TO DEBUG. The
  scheduled task carried the autoplay flag and the desktop shortcut did not, so
  the same board was audible when it started itself and silent when you started
  it. One definition, two callers, no drift.
#>

# The repo is wherever this script's parent is, never a hardcoded path — these
# files have to survive being cloned onto another machine.
$script:Repo = Split-Path -Parent $PSScriptRoot
$DayboardRepo = $script:Repo

# ─── The port, from data/settings.json ───────────────────────────────────────
# 6767 unless the settings menu says otherwise (Settings -> Screen & look). One
# place, read by every script, and passed to the PC agent's --origin list by
# setup.ps1 — so changing it in the menu and re-running setup keeps the agent's
# CORS allowlist in step. Under `next start` a taken port is process.exit(1)
# and a dark wall, which is why it is not 3000.
function Get-DayboardSettings {
  $file = Join-Path $DayboardRepo 'data\settings.json'
  if (-not (Test-Path $file)) { return $null }
  try { return (Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}
$DayboardPort = 6767
try {
  $__s = Get-DayboardSettings
  if ($__s -and $__s.board -and $__s.board.port) { $DayboardPort = [int]$__s.board.port }
} catch {}

$DayboardUrl = "http://localhost:$DayboardPort"
$DayboardLogDir = Join-Path $env:LOCALAPPDATA 'dayboard'
$DayboardLog = Join-Path $DayboardLogDir 'server.log'

# ─── Chrome, and the flags that are not decoration ───────────────────────────
#   --autoplay-policy=no-user-gesture-required
#       A board nobody has clicked has a suspended AudioContext, so the nudge
#       chime, the eye break and the takeover all play to nothing.
#   --disable-background-timer-throttling
#       HealthAlert ticks every 30s; Chrome clamps timers to roughly once a
#       minute in a window it thinks is background, so nudges drift late.
#   --disable-backgrounding-occluded-windows
#       Chrome marks an occluded window hidden and stops it entirely — which is
#       precisely when a nudge most needs to fire.
#
# ─── --user-data-dir, WHICH THIS USED TO FORBID ──────────────────────────────
# The old rule was: never pass it, because the default profile holds the
# notification grant, dayboard.panel.*, the eye-break state and where the corner
# player was parked, and a separate profile starts with none of that. All true.
# It was still the wrong trade, and the way it failed was worse than what it
# protected.
#
# Chrome runs ONE browser process per user-data-dir. Sharing the default profile
# therefore meant the board's launch became the singleton for all of your
# browsing, and the kiosk flags below went with it: every window you opened after
# a reboot started fullscreen, every link you clicked opened a tab in the same
# browser as the board, and the board window ended up buried behind them. The
# display took over the machine instead of sitting on it.
#
# A dedicated profile makes the board its own process. Its flags stop leaking,
# your browsing cannot bury it, and closing all your windows cannot close it.
#
# WHAT IT COSTS, AND WHY THAT IS NOW SMALL. localStorage is per-origin as well as
# per-profile, so moving 3000 -> 6767 had already reset the panel layout, the
# eye-break state and the parked player. The notification grant is per-origin
# too, so it needed giving again regardless. The profile is created once and then
# persists, so this is one re-grant, not one per launch.
#
# The list of cleared videos was on that casualty list when this was written, and
# it is the reason it no longer is: two moves that had nothing to do with videos
# each wiped it. It is data/watched.json now — see src/lib/schema.ts.
$DayboardProfile = Join-Path $env:LOCALAPPDATA 'dayboard\chrome-profile'

$DayboardChromeArgs = @(
  "--app=$DayboardUrl"
  "--user-data-dir=$DayboardProfile"
  '--start-fullscreen'
  '--autoplay-policy=no-user-gesture-required'
  '--disable-background-timer-throttling'
  '--disable-backgrounding-occluded-windows'
  # First run in a fresh profile otherwise opens a "welcome to Chrome" tab and a
  # default-browser prompt in front of the board.
  '--no-first-run'
  '--no-default-browser-check'
)

# ─── The stream browser ──────────────────────────────────────────────────────
# The Sports tab plays streaming sites in a SECOND Chrome, in its own profile,
# that agent/stream tucks inside the board window. The server launches it
# (src/lib/stream-host.ts) — these exist so you can open the same profile by
# hand with scripts\stream.ps1. KEEP IN STEP WITH chromeArgs() in
# src/lib/stream.ts.
#
# Its own profile because that is where the streaming logins live: Apple TV,
# Peacock, ESPN and the rest are signed in here and nowhere else on the board.
$DayboardStreamProfile = Join-Path $env:LOCALAPPDATA 'dayboard\stream-profile'
$DayboardStreamPort = 9224

$DayboardStreamArgs = @(
  '--kiosk'
  "--user-data-dir=$DayboardStreamProfile"
  "--remote-debugging-port=$DayboardStreamPort"
  '--no-first-run'
  '--no-default-browser-check'
  '--autoplay-policy=no-user-gesture-required'
  '--disable-background-timer-throttling'
  '--disable-backgrounding-occluded-windows'
)

# ─── The music browser ───────────────────────────────────────────────────────
# The Music tab's music.apple.com, in a THIRD Chrome with its own profile — the
# Apple ID lives there. Same flags as the stream browser; its own profile and
# port because agent/stream mutes the stream browser's whole process tree, and a
# muted match must not mean muted music. KEEP IN STEP WITH src/lib/music.ts.
# scripts\music.ps1 opens it by hand.
$DayboardMusicProfile = Join-Path $env:LOCALAPPDATA 'dayboard\music-profile'
$DayboardMusicPort = 9225

function Get-DayboardChrome {
  foreach ($p in @(
      'C:\Program Files\Google\Chrome\Application\chrome.exe',
      'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Get-DayboardNode {
  $n = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $n) { $n = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
  return $n
}

function Write-DayboardLog([string]$text) {
  New-Item -ItemType Directory -Force $DayboardLogDir | Out-Null
  Add-Content -Path $DayboardLog -Encoding utf8 `
    -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text)
}

<#
  Who is listening on a port, as pids. Get-NetTCPConnection is a kernel table
  lookup — no connection attempt, no DNS, sub-millisecond. Test-NetConnection
  does a DNS resolve and an ICMP ping first and burns about a second per call
  even when it succeeds, which is why nothing here uses it.
#>
function Get-PortOwners([int]$Port) {
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique) |
    Where-Object { $_ -and $_ -ne $PID }
}

<#
  Take the port back, whatever is holding it.

  `schtasks /End` stops the task's own process; Microsoft's own reference for it
  says to use TaskKill for anything that task started. So an orphaned node can
  keep the port after the task reports Ready, and the next start dies instantly
  on EADDRINUSE. Treating the port as the truth rather than the task's state is
  what makes a restart reliable.
#>
<#
  Stop any serve.ps1 supervisor other than this process.

  Ending the task should do this, but "should" is doing a lot of work: a
  supervisor orphaned by an earlier registration is not attached to any task any
  more, so no amount of schtasks reaches it. It would sit there restarting the
  server underneath the one we are about to start. serve.ps1 refuses to run
  twice, but a stale one holding the mutex would then shut the NEW one out, so
  the stale process has to actually go.
#>
function Stop-DayboardSupervisors {
  # Match the INVOCATION, not the mention. A plain `-like '*serve.ps1*'` also
  # matches any shell whose command line merely names the file — including a
  # diagnostic one-liner asking how many supervisors there are, which then counts
  # and kills itself. The -File form is what Task Scheduler actually launches.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '-File\s+"[^"]*\\serve\.ps1"' -and $_.ProcessId -ne $PID } |
    ForEach-Object {
      Write-DayboardLog "stopping stale supervisor (pid $($_.ProcessId))"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Clear-DayboardPort([int]$Port, [int]$TimeoutSeconds = 15) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $held = Get-PortOwners $Port
    if (-not $held) { return $true }
    foreach ($procId in $held) {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($proc) {
        Write-DayboardLog "port $Port held by $($proc.ProcessName) (pid $procId) — stopping it"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Milliseconds 300
  }
  # Almost always means an elevated process owns it, which a Limited task cannot
  # touch. Say so rather than looping in silence.
  Write-DayboardLog "port $Port would not free — if something elevated holds it, end it from an admin shell"
  return $false
}

<#
  Is the board actually answering? Not "is something bound" — /robots.txt is
  prerendered and loads no data, so it answers the instant the server is up. It
  is the same probe BoardReset already polls from the browser.
#>
function Test-DayboardUp([int]$Port, [int]$TimeoutSeconds = 2) {
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    return $false
  }
  try {
    Invoke-WebRequest "http://127.0.0.1:$Port/robots.txt" -UseBasicParsing -TimeoutSec $TimeoutSeconds | Out-Null
    return $true
  } catch {
    return $false
  }
}

<#
.SYNOPSIS
  From a fresh clone to a board that starts with Windows. The one command.

.DESCRIPTION
  Idempotent and safe to re-run: every step checks before it acts, and the
  scheduled tasks are replaced rather than duplicated. Run it again after
  changing the port, turning an integration on in the settings menu, or pulling
  a new version.

  It reads data/settings.json (what the board's setup guide writes) to decide
  which optional tasks to register — the mail poller only if Mail is on, the
  Amazon poller only if Packages is on — so the guide and this script agree.

  What it registers, all at logon, none needing admin:

    dayboard-server    the production Next server      (scripts\serve.ps1)
    dayboard-board     Chrome, fullscreen, once it answers (scripts\board.ps1)
    dayboard-restart   on demand: the board's own reset button
    dayboard-refresh   daily at 06:00: team schedules and watch links
    dayboard-mail      every 5 minutes, when Mail is on
    dayboard-amazon    every 30 minutes, when Packages is on

  Plus a desktop shortcut carrying the identical Chrome flags.

.PARAMETER Agent
  Also register dayboard-nowplaying, the PC agent. NEEDS AN ELEVATED SHELL:
  the task runs -RunLevel Highest, which is what makes CPU temperature and fan
  speeds appear (a kernel driver reads them). Build it first:
    cd agent\nowplaying; dotnet publish -c Release -o dist

.PARAMETER SkipDeps
  Skip npm ci and the build. For re-registering tasks only.

.PARAMETER TasksOnly
  Same as -SkipDeps, and do not start anything afterwards.

.PARAMETER Uninstall
  Remove every task this script registers, and the shortcut.

.EXAMPLE
  ALWAYS through powershell with -ExecutionPolicy Bypass, never by path: a
  default Windows refuses a .ps1 invoked directly ("running scripts is disabled
  on this system"). The tasks this registers carry the same flag themselves.

  powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup.ps1"
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup.ps1" -Agent
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup.ps1" -Uninstall
#>
[CmdletBinding()]
param(
  [switch]$Agent,
  [switch]$SkipDeps,
  [switch]$TasksOnly,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_common.ps1"

Set-Location $DayboardRepo

$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    ! $text" -ForegroundColor Yellow }

$ALL_TASKS = @('dayboard-server', 'dayboard-board', 'dayboard-restart', 'dayboard-refresh',
               'dayboard-mail', 'dayboard-amazon', 'dayboard-nowplaying')

# ─── Uninstall ───────────────────────────────────────────────────────────────
if ($Uninstall) {
  Step 'Removing Dayboard tasks'
  foreach ($name in $ALL_TASKS) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Ok "removed $name"
    }
  }
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Dayboard.lnk'
  if (Test-Path $lnk) { Remove-Item $lnk; Ok 'removed the desktop shortcut' }
  Write-Host ''
  Write-Host 'Done. The repo, data/ and the Chrome profiles under %LOCALAPPDATA%\dayboard are untouched.' -ForegroundColor Green
  exit 0
}

# ─── The settings, as far as this script needs them ──────────────────────────
$settings = Get-DayboardSettings
$mailOn = $false; $amazonOn = $false
try { $mailOn = [bool]$settings.mail.enabled } catch {}
try { $amazonOn = [bool]$settings.amazon.enabled } catch {}

Write-Host ''
Write-Host "Dayboard setup — $DayboardRepo on port $DayboardPort" -ForegroundColor Green

# ─── 1. Prerequisites, all reported at once ──────────────────────────────────
Step 'Checking prerequisites'

$missing = @()
function Need($cmd, $what, [switch]$Optional) {
  $found = $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
  if ($found) { Ok "$cmd — ok" }
  elseif ($Optional) { Warn "$cmd missing — $what" }
  else { Warn "$cmd MISSING — $what"; $script:missing += $cmd }
}

Need 'node'   'the board itself. Node 20.9 or newer.'
Need 'npm'    'installing dependencies.'
Need 'dotnet' 'the PC agent (Now Playing, the Computer tab) and the Sports/Music windows. .NET 8 SDK.' -Optional
$py = Get-Command 'py' -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command 'python' -ErrorAction SilentlyContinue }
if ($py) { Ok "python — ok" } elseif ($mailOn -or $amazonOn) { Warn 'python missing — the mail and package pollers need Python 3.' }

if (-not (Get-DayboardChrome)) {
  Warn 'Chrome MISSING — the board window and its desktop shortcut.'
  $missing += 'chrome'
}

if ($missing.Count -gt 0) {
  throw "Install these first: $($missing -join ', ')"
}

# ─── 2. Dependencies and the build ───────────────────────────────────────────
if (-not ($SkipDeps -or $TasksOnly)) {
  Step 'Installing node dependencies (npm ci)'
  # NOT --omit=dev: the build needs typescript, and every data script runs
  # through tsx. Both are devDependencies.
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  Ok 'done'

  Step 'Building the board'
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'next build failed.' }
  Ok 'done'

  if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    # The window helper for the Sports and Music tabs. Small, unelevated, and a
    # child of the server — it only has to exist.
    Step 'Building the window helper (agent\stream)'
    Push-Location (Join-Path $DayboardRepo 'agent\stream')
    try {
      & dotnet publish -c Release -o dist
      if ($LASTEXITCODE -ne 0) { Warn 'stream helper build failed — the Sports and Music tabs cannot frame a window.' } else { Ok 'done' }
    } finally { Pop-Location }
  }
}

if (-not (Test-Path (Join-Path $DayboardRepo '.next\BUILD_ID'))) {
  Warn "No production build — run 'npm run deploy' or the server task will exit immediately."
}

# ─── 3. Tasks ────────────────────────────────────────────────────────────────
Step 'Registering scheduled tasks'

<#
  Settings shared by everything that must never stop on its own.

  ExecutionTimeLimit 0 is the one that matters most and the easiest to leave out:
  THE DEFAULT IS THREE DAYS, after which Task Scheduler kills a perfectly healthy
  board. A display that is always on is meant to outlive that by months.
#>
function New-ForeverSettings {
  New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
}

function New-PollSettings {
  # A poller is short-lived; give it ten minutes and let a stuck one be killed.
  New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -StartWhenAvailable
}

function Register-DayboardTask {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)]$Action,
    [Parameter(Mandatory)]$Settings,
    [string]$RunLevel = 'Limited',
    $Trigger = $null,
    [switch]$NoTrigger
  )
  # -RunLevel cannot be patched in place, so an existing task is removed rather
  # than updated. Unregistering also stops it if it is running.
  try {
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop
    }
    $reg = @{ TaskName = $Name; Action = $Action; Settings = $Settings; RunLevel = $RunLevel }
    if (-not $NoTrigger) {
      $reg.Trigger = if ($Trigger) { $Trigger } else { New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME }
    }
    Register-ScheduledTask @reg -ErrorAction Stop | Out-Null
    Ok "registered $Name"
  } catch [System.UnauthorizedAccessException], [Microsoft.Management.Infrastructure.CimException] {
    throw @"
Access denied registering '$Name'.

On this machine registering a scheduled task needs an ELEVATED shell.
Right-click PowerShell -> Run as administrator, then:

  cd "$DayboardRepo"
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup.ps1" -TasksOnly$(if ($Agent) { ' -Agent' })
"@
  }
}

function Remove-DayboardTask([string]$Name) {
  if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
    Ok "removed $Name (turned off in settings)"
  }
}

<#
  Everything runs through `conhost.exe --headless`, which is the difference
  between a console window sitting on the board and nothing at all.

  -WindowStyle Hidden IS NOT ENOUGH. Task Scheduler starts an interactive task
  in the user's session with a console attached, and PowerShell hides its own
  window only after the host has already drawn one — so a terminal appears and
  stays. conhost --headless gives the process a console that was never put on
  screen.
#>
function New-ScriptAction([string]$Script) {
  New-ScheduledTaskAction -Execute 'conhost.exe' -WorkingDirectory $DayboardRepo `
    -Argument ("--headless `"{0}`" -NoProfile -ExecutionPolicy Bypass -File `"{1}`"" -f $ps, (Join-Path $PSScriptRoot $Script))
}

function New-CmdAction([string]$Cmd) {
  New-ScheduledTaskAction -Execute 'conhost.exe' -WorkingDirectory $DayboardRepo `
    -Argument ("--headless cmd.exe /c `"{0}`"" -f $Cmd)
}

# The server. No task-level restart: serve.ps1 is the supervisor, and two
# supervisors fight over the port.
Register-DayboardTask -Name 'dayboard-server' -Action (New-ScriptAction 'serve.ps1') -Settings (New-ForeverSettings)

# The restart, as a task the server's own reset button can /Run.
Register-DayboardTask -Name 'dayboard-restart' -NoTrigger -Action (New-ScriptAction 'restart-server.ps1') -Settings (New-ForeverSettings)

# The daily refresh: team schedules from ESPN, watch links, validation.
Register-DayboardTask -Name 'dayboard-refresh' `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 06:00) `
  -Action (New-CmdAction 'npm run --silent refresh') -Settings (New-PollSettings)

# The pollers, only when their tabs are on.
if ($mailOn) {
  $every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
  Register-DayboardTask -Name 'dayboard-mail' -Trigger $every5 `
    -Action (New-CmdAction (Join-Path $DayboardRepo 'agent\mail\run_poll.cmd')) -Settings (New-PollSettings)
} else { Remove-DayboardTask 'dayboard-mail' }

if ($amazonOn) {
  $every30 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 30)
  Register-DayboardTask -Name 'dayboard-amazon' -Trigger $every30 `
    -Action (New-CmdAction (Join-Path $DayboardRepo 'agent\amazon\run_poll.cmd')) -Settings (New-PollSettings)
} else { Remove-DayboardTask 'dayboard-amazon' }

# The window, and the shortcut.
$chrome = Get-DayboardChrome
if ($chrome) {
  Register-DayboardTask -Name 'dayboard-board' -Action (New-ScriptAction 'board.ps1') -Settings (New-ForeverSettings)

  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Dayboard.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $chrome
  $sc.Arguments = ($DayboardChromeArgs -join ' ')
  $sc.WorkingDirectory = Split-Path $chrome
  $icon = Join-Path $DayboardRepo 'src\app\favicon.ico'
  $sc.IconLocation = $(if (Test-Path $icon) { "$icon,0" } else { "$chrome,0" })
  $sc.Description = 'Dayboard, with the flags its alerts depend on'
  $sc.Save()
  Ok "wrote $lnk"
}

# ─── 4. The PC agent, only when asked and only elevated ──────────────────────
if ($Agent) {
  $exe = Join-Path $DayboardRepo 'agent\nowplaying\dist\dayboard-nowplaying.exe'
  $elevated = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
              ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

  if (-not (Test-Path $exe)) {
    Warn 'Agent not built — run: cd agent\nowplaying; dotnet publish -c Release -o dist'
  } elseif (-not $elevated) {
    Warn '-Agent needs an elevated shell; skipped. (Right-click PowerShell -> Run as administrator.)'
  } else {
    Get-Process 'dayboard-nowplaying' -ErrorAction SilentlyContinue | ForEach-Object {
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }

    # --origin is an allowlist and passing any REPLACES the defaults, so both
    # spellings of the board's origin are here, from the configured port.
    $agentArgs = "--origin http://localhost:$DayboardPort --origin http://127.0.0.1:$DayboardPort"
    try {
      $app = [string]$settings.pc.nowPlayingApp
      if ($app) { $agentArgs += " --app `"$app`"" }
      $hp = @($settings.pc.headphoneNames) -join ','
      $sp = @($settings.pc.speakerNames) -join ','
      if ($hp) { $agentArgs += " --headphones `"$hp`"" }
      if ($sp) { $agentArgs += " --speakers `"$sp`"" }
    } catch {}

    $agentAction = New-ScheduledTaskAction -Execute 'conhost.exe' `
      -Argument ("--headless `"{0}`" {1}" -f $exe, $agentArgs)
    Register-DayboardTask -Name 'dayboard-nowplaying' -Action $agentAction `
      -Settings (New-ForeverSettings) -RunLevel 'Highest'
    Start-ScheduledTask -TaskName 'dayboard-nowplaying'
    Start-Sleep -Seconds 2
    try {
      $probe = Invoke-WebRequest 'http://127.0.0.1:7343/health' -UseBasicParsing -TimeoutSec 3 -Headers @{ Origin = $DayboardUrl }
      if ($probe.Headers['Access-Control-Allow-Origin'] -eq $DayboardUrl) { Ok "agent accepts $DayboardUrl" }
      else { Warn "agent replied with Allow-Origin '$($probe.Headers['Access-Control-Allow-Origin'])' — the widgets will stay dark." }
    } catch {
      Warn "agent did not answer on 127.0.0.1:7343 — $($_.Exception.Message)"
    }
  }
}

# ─── 5. Up ───────────────────────────────────────────────────────────────────
if (-not $TasksOnly) {
  Step 'Starting the board'
  Start-ScheduledTask -TaskName 'dayboard-server'
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    if (Test-DayboardUp $DayboardPort) { break }
    Start-Sleep -Milliseconds 500
  }
  if (Test-DayboardUp $DayboardPort) {
    Ok "board is up on $DayboardUrl"
    if ($chrome) { Start-ScheduledTask -TaskName 'dayboard-board' }
  } else {
    Warn "board did not answer within 90s — see $DayboardLog"
  }
}

Write-Host ''
Write-Host 'Done. Still to do by hand, on the board itself:' -ForegroundColor Yellow
Write-Host '  - the setup guide opens on launch: work down its sections'
Write-Host '  - press "Turn on alerts" once, for the chime and notifications'
if (-not $Agent) {
  Write-Host '  - for the PC agent (Now Playing, Computer tab), from an ELEVATED shell:'
  Write-Host '      powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup.ps1" -TasksOnly -Agent'
}
Write-Host ''

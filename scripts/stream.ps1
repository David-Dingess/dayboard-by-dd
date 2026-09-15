<#
  Open the Sports tab's stream profile as an ordinary Chrome window.

      powershell -File scripts\stream.ps1                      # the profile, on a new tab page
      powershell -File scripts\stream.ps1 https://tv.apple.com # straight to a site

  YOU DO NOT NEED THIS TO LOG IN. Clicking a team tile opens the site inside the
  board, and signing in there works like signing in anywhere. This is for the
  things a kiosk window has no room for: Chrome's own settings, turning on
  password sync so saved logins come across, or clearing a site's data.

  It refuses while the stream is open on the board. Chrome runs one process per
  profile, so a second launch would hand this window to the kiosk browser — and
  the board would adopt it.
#>
param([string]$Url = '')

. "$PSScriptRoot\_common.ps1"

try {
  Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$DayboardStreamPort/json/version" -TimeoutSec 2 | Out-Null
  Write-Host 'The stream browser is running on the board. Close the player there (the X on its bar) and wait for it to shut, or end chrome.exe for the stream profile, then run this again.' -ForegroundColor Yellow
  exit 1
} catch {
  # Not running, which is what this needs.
}

$chrome = Get-DayboardChrome
if (-not $chrome) { throw 'Chrome is not installed where the board expects it.' }

$chromeArgs = @(
  "--user-data-dir=`"$DayboardStreamProfile`""
  '--no-first-run'
  '--no-default-browser-check'
)
if ($Url) { $chromeArgs += "`"$Url`"" }

Start-Process $chrome -ArgumentList $chromeArgs
Write-Host "Opened the stream profile ($DayboardStreamProfile). Close the window when you are done." -ForegroundColor Green

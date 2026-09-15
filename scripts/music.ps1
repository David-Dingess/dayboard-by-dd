<#
  Open the Music tab's profile as an ordinary Chrome window.

      powershell -File scripts\music.ps1

  YOU DO NOT NEED THIS TO SIGN IN. The Music tab opens your music service inside
  the board, and signing in there works. This is for what a kiosk window has no
  room for: Chrome's own settings, a stubborn sign-in, or clearing a site's data.

  It refuses while the music browser is running on the board. Chrome runs one
  process per profile, so a second launch would hand this window to the kiosk
  browser — and the board would adopt it.
#>
param([string]$Url = '')

. "$PSScriptRoot\_common.ps1"

if (-not $Url) {
  $Url = 'https://music.apple.com/'
  try { $__m = (Get-DayboardSettings).music.home; if ($__m) { $Url = [string]$__m } } catch {}
}

try {
  Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$DayboardMusicPort/json/version" -TimeoutSec 2 | Out-Null
  Write-Host 'The music browser is running on the board. End chrome.exe for the music profile (it keeps playing while the tab is hidden), then run this again.' -ForegroundColor Yellow
  exit 1
} catch {
  # Not running, which is what this needs.
}

$chrome = Get-DayboardChrome
if (-not $chrome) { throw 'Chrome is not installed where the board expects it.' }

$chromeArgs = @(
  "--user-data-dir=`"$DayboardMusicProfile`""
  '--no-first-run'
  '--no-default-browser-check'
  "`"$Url`""
)

Start-Process $chrome -ArgumentList $chromeArgs
Write-Host "Opened the music profile ($DayboardMusicProfile). Close the window when you are done." -ForegroundColor Green

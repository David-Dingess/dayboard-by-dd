# The agents

Four small programs run beside the board. None is required; each unlocks a
module. All read `data/settings.json`; the two Python ones fall back to an
`.env` in their own folder.

## The PC agent — `agent/nowplaying` (C#, .NET 8, Windows)

One process, one port (7343, loopback only), several routes:

| Route | Feeds |
|---|---|
| `/nowplaying`, `/art`, `/events` (SSE) | Now Playing: the Windows media session, album art, a WASAPI loopback FFT for the EQ |
| `/vitals` | The Computer tab: CPU, GPU, memory, fans, drives, disks, network, top processes (LibreHardwareMonitor) |
| `/audio` | The headphones/speakers toggle and mic mute, through Voicemeeter's Remote API |
| `/claude`, `/claude/activity` | The Claude usage bars and the cat: the CLI's credentials file and session files |
| `/board` | Keeps the board window on top and fullscreen (a KVM leaves the taskbar over it otherwise) |

The browser reads it directly — a server has no route to 127.0.0.1 on your
desk — so `--origin` is a CORS allowlist and passing any origin replaces the
defaults. `setup.ps1 -Agent` passes both spellings of the configured port.

```powershell
cd agent\nowplaying; dotnet publish -c Release -o dist
dist\dayboard-nowplaying.exe                       # by hand, unelevated
dist\dayboard-nowplaying.exe --dump-sensors        # what this machine exposes
dist\dayboard-nowplaying.exe --audio-dump          # Voicemeeter buses and strips
```

Flags: `--port`, `--app any|Spotify|AppleMusic` (which media session to follow),
`--origin` (repeatable), `--no-pin`, `--headphones a,b` and `--speakers c,d`
(fragments of the Voicemeeter device names). The setup guide's Computer section
writes the last three into settings and `setup.ps1` passes them.

**Elevation.** Temperatures and fans come through a kernel driver, so the task
is registered `-RunLevel Highest` from an elevated shell. Unelevated, the panel
degrades per field and says which half it is missing. The exe deliberately
carries no `requireAdministrator` manifest, so a manual launch never prompts.

**Sensor names** differ by vendor. `Vitals.cs` matches the common AMD and Intel
names with fallbacks; `--dump-sensors` shows yours, and the thresholds in
`src/lib/vitals.ts` are the place to tune "warn" and "crit".

**Voicemeeter** is optional. Without it, or with it closed, the board simply has
no audio buttons. With it, the toggle mutes one bus and unmutes the other rather
than reassigning devices, so it is instant and reversible in Voicemeeter's own
window. Assign the headphones and speakers to A1 and A2 first.

`dist/` is gitignored; rebuild after any change. An old build answers a route
the board expects with 404, and the Computer tab says so.

## The window helper — `agent/stream` (C#, .NET 8, Windows)

Nothing to configure. `npm run deploy` and `setup.ps1` build it. The server
starts it on the first Sports or Music tile click; it makes a kiosk Chrome a
child window of the board, sized to the tab's stage, with holes cut for the
corner players. Two profiles, `%LOCALAPPDATA%\dayboard\stream-profile` and
`music-profile`, so the streaming logins and the music login never meet your
own browser.

Why a real Chrome: every sports service and music site refuses to be framed,
WebView2 has no Widevine, and Electron is rejected without paid signing.

## The mail poller — `agent/mail` (Python 3)

Standard library IMAP plus `python-dotenv`. Reads the `mail` section of
settings (host, port, user, app password, mailbox, trash folder, limit), writes
`data/mail.json`, and processes the board's delete queue first by moving each
message to the trash folder — reversible. Reading never marks a message seen.

```powershell
cd agent\mail; py -3 -m pip install -r requirements.txt
run_poll.cmd
```

`setup.ps1` registers `dayboard-mail` every five minutes while Mail is on.

## The Amazon poller — `agent/amazon` (Python 3)

`amazon-orders` plus Playwright's Chromium for the sign-in challenge. Reads the
`amazon` section of settings, writes `data/packages.json`. There is no Amazon
API for this, so it signs in as you.

```powershell
cd agent\amazon; py -3 -m pip install -r requirements.txt; py -3 -m playwright install chromium
run_login.cmd        # once, by hand — the OTP is yours to answer
run_poll.cmd
```

Exit code 2 means no credentials; 3 means the session expired and
`run_login.cmd` is needed again. amazon.com only. `setup.ps1` registers
`dayboard-amazon` every thirty minutes while Packages is on.

Both pollers' credentials live in `data/settings.json` on this machine and
nowhere else.

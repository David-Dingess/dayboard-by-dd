# Setting up

Everything here is also in the board's own setup guide (the gear in the
bottom-right corner, or `/?setup`). This is the same content in one page, for
reading before you start or for a machine you cannot see the board on.

## 1. The board itself

```powershell
git clone https://github.com/David-Dingess/dayboard-by-dd.git
cd dayboard-by-dd
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

**Always through `powershell -ExecutionPolicy Bypass -File`**, never by
double-clicking a `.ps1`: a default Windows refuses scripts run directly. The
tasks it registers carry the same flag, so the board starts whatever the policy
says.

It registers four scheduled tasks (server, board window, an on-demand restart,
a daily schedule refresh) and a desktop shortcut with the Chrome flags the
alerts depend on. `-Uninstall` removes them. Re-run it after changing the port
or turning on Mail or Packages.

The board is served on **http://localhost:6767** from `scripts/serve.ps1`, bound
to 127.0.0.1 only. Its Chrome profile lives at `%LOCALAPPDATA%\dayboard\chrome-profile`,
separate from the browser you browse with, so the kiosk flags do not leak.

Every setting is in `data/settings.json`, which is gitignored. `npm run settings`
reads and writes it from a terminal.

## 2. Screen & look

The board was drawn for a 3440×1440 ultrawide and every other size is that
board scaled to fit (`src/lib/screen.ts`). Pick your monitor from the dropdown
or leave it on **Auto**, which measures the window. The animated background can
be turned off, and its colour changed; keep it dark, the palette assumes it.

## 3. Location & weather

Search for your city; Open-Meteo's geocoder returns the coordinates and the
timezone together. Weather, air quality, sunrise and sunset, and every date on
the board follow it. Pollen is US-only (pollen.com by ZIP).

## 4. Calendars

Any ICS address, in its own colour, with optional hide rules (regexes against
the title — `^lunch$` keeps a work calendar's standing holds off the board).

- **Google**: calendar.google.com → Settings → the calendar → *Integrate calendar* → *Secret address in iCal format*.
- **iCloud**: Calendar → share → *Public Calendar* → the webcal link.
- **Outlook.com / Microsoft 365**: Settings → Calendar → *Shared calendars* → Publish → *Can view all details* → the ICS link.

The address is a credential: anyone holding it reads that calendar. It stays in
the gitignored settings file, and `npm run validate` fails if one ever reaches a
tracked file.

**The phone feed.** The board publishes everything — team fixtures with alarms,
birthdays, health sessions — as `/feeds/<token>/dayboard.ics`. Create a token in
the Calendars section and subscribe on the phone (iPhone: Settings → Calendar →
Accounts → Add Account → Other → Add Subscribed Calendar). The server listens on
localhost, so the phone needs to reach the machine (same network with a port
open, or a tunnel).

## 5. Birthdays

Rows of name, month, day — typed, or pasted as `name,month,day` lines (a
Facebook birthdays export has exactly that shape).

## 6. Sports

Pick a league, pick a team. Each becomes a layer with its colour and ESPN's
crest: fixtures on the calendar and the phone feed with an alarm an hour before,
a live score while it is on, a tile on the Sports tab that opens the right
streaming site, and a pulse on the tab at kickoff. Tick the cups and continental
competitions a club also plays in.

Schedules are pulled by `npm run refresh`, which the daily task runs at 06:00;
the *Refresh schedules now* button runs it in the background. A team ESPN does
not list can be an ICS URL instead (`ics.fixtur.es`, `fixturedownload.com`, or
the club's own).

The watch links name **US** services (`src/lib/watch.ts`). The Sports tab plays
those sites in a real Chrome, kiosk-framed and parented into the board by
`agent/stream` — sign in there like any browser; the logins live in
`%LOCALAPPDATA%\dayboard\stream-profile`.

## 7. Discord

Server ids (Developer Mode → right-click the server → Copy Server ID), with
**Server Settings → Widget → Enable Server Widget** on each. That endpoint is
public, which is why no bot is needed — and why the server's online member list
becomes readable to anyone holding the id.

Optionally a bot token and a list of user ids, so people set to Invisible still
show while they are in a call: discord.com/developers → New Application → Bot →
Reset Token; OAuth2 URL Generator with scope `bot` and permissions *View
Channels* and *Connect*; add it to the server.

## 8. YouTube

Channel ids (`UC…`: the channel page → *…more* → *Share channel* → *Copy channel
ID*), or a Google Takeout `subscriptions.csv` pasted whole. No API key; every
channel has a public feed.

## 9. Twitch

Register an app at dev.twitch.tv/console/apps (Confidential, redirect
`http://localhost:7345/callback`), save the client id and secret, press
**Authorize**. The refresh token is permanent for a confidential client; it dies
only if you change your Twitch password or revoke the app, and the panel says so.

## 10. Email

IMAP host, address, **app password** (never the account password), mailbox.
Presets for Gmail, Outlook.com, iCloud, Fastmail and Yahoo. *Try signing in*
does a real IMAP LOGIN. The poller is Python: `cd agent\mail; py -3 -m pip
install -r requirements.txt`, then re-run `setup.ps1` with Mail on and it
registers a five-minute task.

## 11. Packages

Amazon email and password, stored **locally in plain text** in
`data/settings.json`. `py -3 -m pip install -r requirements.txt; py -3 -m
playwright install chromium` in `agent\amazon`, then `run_login.cmd` once by
hand to clear the OTP; the session is reused headlessly. `setup.ps1` registers a
thirty-minute task while Packages is on. amazon.com only.

## 12. Computer & Now Playing

The PC agent (`agent/nowplaying`, C#): what Windows is playing with album art
and a live EQ, CPU/GPU/memory/fans/drives/network, the Claude usage bars, and —
through Voicemeeter — the headphones/speakers toggle and mic mute.

```powershell
cd agent\nowplaying; dotnet publish -c Release -o dist
```

Then from an **elevated** PowerShell (temperatures need a kernel driver):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -TasksOnly -Agent
```

Unelevated it still runs, with load and memory and no temperatures. See
[agents.md](agents.md).

## 13. Claude usage

Needs the PC agent and the Claude CLI signed in (`claude` once in a terminal).
The agent reads the CLI's own credentials file and asks for the usage numbers
the CLI itself shows; nothing is sent anywhere else.

## 14. Music

The service's web player in its own Chrome profile, framed as a tab. Apple
Music by default; YouTube Music, Spotify, Tidal, SoundCloud, Deezer, Amazon
Music and Bandcamp are accepted. Sign in inside the tab.

## 15. Nudges & health

The bell in the bottom-left row lists every nudge; add your own with a label, a
time and the days. Quiet hours, the eye-break interval and the programme's
start date are on the Health tab's settings card. Press **Turn on alerts** once
so the chime and the notifications are allowed.

**Before you exercise:** the programme, its cues and its drawn animations were
written and illustrated entirely by Claude, an AI, and reviewed by no doctor or
trainer. It is not medical advice. Check with a doctor first, stop if anything
hurts, and use it at your own risk. The full note is in the
[README](../README.md#health-and-exercise-read-this-first).

## 16. Subway (New York)

Off by default. Turn it on, pick a home station from the MTA list, the lines
and the direction. Keyless MTA feeds.

## 17. Stream Deck

See [streamdeck.md](streamdeck.md).

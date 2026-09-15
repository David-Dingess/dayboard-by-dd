# Dayboard by DD

A dashboard for your second monitor. Your calendars in the middle; the weather, the
trains, what is playing, the score and who is in voice down the left; the agenda,
the to-dos, the mail, the packages and the machine's vitals in tabs on the
right. Sports schedules for the teams you pick, live scores while they play, and
the team's streaming site framed inside the board. A 52-week exercise programme
with drawn animations, nudges, and a 20/20/20 eye break. YouTube uploads and
Twitch streams that play in the board. A Stream Deck plugin to drive it all.

It refreshes itself every thirty seconds and never asks you to press anything.

Next.js, JSON files as the database, no cloud, no accounts, no API keys for the
basics. Windows for the whole thing; the board itself runs anywhere Node runs.

**[Read the introduction](introduction/README.md)** for the walkthrough and the
screenshots.

## Five minutes to a board

```powershell
git clone https://github.com/David-Dingess/dayboard-by-dd.git
cd dayboard-by-dd
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

That installs the dependencies, builds the board, registers it to start at
logon, starts it, and opens it fullscreen in its own Chrome window. The
**setup guide** opens on launch: work down its sections. Only *Location* is
needed for the board to be useful; everything else turns on as you fill it in.

Needs **Node 20.9+** and **Chrome**. The optional parts need more — the section
that uses each one says what and how:

| For | Needs |
|---|---|
| Now Playing, the Computer tab, Claude usage, the audio buttons | .NET 8 SDK (the PC agent), Windows |
| The Sports and Music tabs' framed windows | .NET 8 SDK, Windows |
| Mail, Packages | Python 3 |
| The Stream Deck | the Stream Deck app |

Prefer a terminal? `npm install`, `npm run build`, `npm start -- -p 6767`, and
open http://localhost:6767. The guide still opens.

## What is in the box

| Module | What it gives you | Source |
|---|---|---|
| **Calendar** | Week and month views, an event editor, every calendar you subscribe to in its own colour, an ICS feed your phone can subscribe to | Any ICS URL: Google, iCloud, Outlook, Exchange |
| **Weather** | Now, the next twelve hours, five days, air quality, pollen, a daylight bar | Open-Meteo (no key), pollen.com (US) |
| **Sports** | A layer per team with fixtures and alarms, live scores, where-to-watch links, the streaming site framed in the board | ESPN's public API, or an ICS feed |
| **Watch** | New uploads from your YouTube channels, live Twitch streams you follow, playing in the board | YouTube RSS (no key), Twitch (one-time authorization) |
| **Music** | Your music service's web player, framed as a tab | Apple Music, YouTube Music, Spotify, Tidal, … |
| **Health** | A 52-week strength and mobility programme, drawn exercise animations, walk timer, chair routine, nudges, the eye break | Built in |
| **Discord** | Who is in voice on your servers, a chime when someone joins | The server widget; optionally a bot |
| **Now Playing / Computer** | Album art and a live EQ, CPU/GPU/memory/fans/drives/network health, top processes | The PC agent (C#, local) |
| **Mail** | The newest messages in one mailbox, delete from the board | IMAP, an app password |
| **Packages** | Amazon orders on the way, out-for-delivery pulses, return windows | Your Amazon login (local poller) |
| **Planner / To-Dos / Notes** | The agenda, a checklist, a scratch page | Built in |
| **Water** | A bottle that fills, a daily goal, a streak | Built in |
| **Claude usage** | Session and weekly limits as thin bars, and a cat that walks while Claude works | The Claude CLI's own login |
| **Subway** | Next trains at your station and disruptions on your lines | MTA (New York only, off by default) |
| **Stream Deck** | Tabs, videos, streams, teams, water, sound, alerts, reset | The plugin in `deck/` |

## Where things live

```
data/settings.json     everything the setup guide writes — gitignored, holds credentials
data/config/*.json     the built-in layers and the health videos
data/layers/*.json     your own events (the editor writes here)
data/cache/*.json      the team schedules, refreshed daily
data/*.json            the to-dos, notes, water, health history, mail, packages — gitignored
src/lib/settings.ts    the settings store; every module reads it fresh
src/components/setup   the setup guide
src/app/page.tsx       the board: three columns, tabs built from settings
agent/nowplaying       the PC agent (C#)
agent/stream           the window helper for the Sports and Music tabs (C#)
agent/mail, agent/amazon   the pollers (Python)
deck/                  the Stream Deck plugin and profile generator
scripts/               setup, deploy, the daily refresh, and the CLIs
```

## Commands

| | |
|---|---|
| `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1` | fresh clone to a board that starts at logon; re-run after changing settings that need a task |
| `npm run deploy` | rebuild and restart after a code change |
| `npm run settings` | what is configured; `-- show`, `-- set location.units metric`, `-- reset` |
| `npm run refresh` | pull the team schedules and watch links now (the daily task does this) |
| `npm run check:widgets` | read Discord, Twitch, the live score and the PC agent back from a terminal |
| `npm run event -- add --title "..." --start "..."` | add an event; `--repeat weekly --on TU,TH` makes it repeat |
| `npm run todo`, `npm run notes`, `npm run water`, `npm run health`, `npm run watched` | the same files the board writes, from a terminal |
| `npm run import:youtube -- subscriptions.csv` | load channels from a Google Takeout export |
| `npm run twitch:auth` | the one-time Twitch authorization, from a terminal |
| `npm run validate` | shape, ids, layers, and the leak check (runs before every deploy) |
| `npm test` | the suite: recurrence, ICS, the health engine, the deck vocabulary, … |

## Docs

- [introduction/README.md](introduction/README.md) — the walkthrough, with screenshots
- [docs/setup.md](docs/setup.md) — every section of the guide, in text, and what each integration needs
- [docs/agents.md](docs/agents.md) — the PC agent, the window helper, the pollers
- [docs/streamdeck.md](docs/streamdeck.md) — the plugin and the profile
- [docs/architecture.md](docs/architecture.md) — how it fits together, and the rules worth knowing before changing it

## Honest limits

- **Windows** for the agents, the framed windows and the scheduled tasks. The board itself is a Next.js app and runs anywhere.
- **US streaming services** in the where-to-watch tables. Elsewhere the competition is right and the service will not be.
- **Anonymous YouTube playback**: ads run, no Premium, and a video whose uploader disabled embedding will not play (every tile has a link out).
- **amazon.com only** for Packages, and it stores your Amazon password locally in plain text. The section says so before you turn it on.
- The board listens on **localhost only** and every write is refused from anywhere else. There is no login: the machine is the boundary.

## Credits

The cat is the OpenPets default pet (MIT — `public/pets/LICENSE-openpets.txt`).
The animated background is a recreation of "Minimalist Black" by ElliotIsLame
for Wallpaper Engine. Weather from Open-Meteo, schedules and scores from ESPN's
public endpoints, transit from the MTA.

MIT licensed. Built by DD.

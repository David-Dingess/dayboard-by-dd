# The Stream Deck

`deck/` is a Stream Deck plugin (SDK 2, Node) and a profile generator. Nothing
on the board needs it; a machine without a deck runs a complete board.

## What the keys do

| Key | Does |
|---|---|
| **Calendar, Music, Watch, Sports, Health** | Show that tab in the centre panel |
| **Live** (folder) | Key *n* plays the *n*th live Twitch stream in the board |
| **Videos** (folder) | Key *n* plays the *n*th unwatched YouTube upload |
| **Sports** (folder) | Key *n* opens the *n*th team's streaming site in the Sports tab |
| **Panels** (folder) | The right panel's tabs: Planner, To-Dos, Computer, Mail, Packages |
| **Full panel video** | Toggles the player between the stage and the whole panel |
| **Water** | Logs a glass (8 oz by default) |
| **Turn on alerts** | Presses the alerts banner — arms the chime and the notification grant |
| **Output** | Headphones ⇄ speakers, through the PC agent and Voicemeeter |
| **Mute** | The mic |
| **Reset the board** | Restarts the server task and reloads the page |

The keys draw themselves from `/api/deck/state` every few seconds while
visible, so the Videos and Live keys show a thumbnail and a title, the team keys
a crest and the next fixture, water the count. The tab keys never light up —
which tab a panel shows lives in the board's browser and is not sent anywhere.

## Install

```powershell
cd deck
npm install
npm run build          # esbuild -> com.dayboard.deck.sdPlugin/bin/plugin.js
npm run link           # symlink into %APPDATA%\Elgato\StreamDeck\Plugins
```

`npm run link` makes a symlink, which Windows only allows with Developer Mode on
(Settings → System → For developers) or from an elevated shell. **Quit the
Stream Deck app from the tray and reopen it**: it scans for plugins at startup
only.

The plugin talks to `http://127.0.0.1:6767`. If the board is on another port,
set `DAYBOARD_URL` in the environment the Stream Deck app runs in, or edit
`deck/src/board.ts` and rebuild.

## The profile

```powershell
cd deck
npm run profile -- --model mk2
```

Models: `mk2` (15 keys; also `original`), `mini` (6), `xl` (32), `plus` (8 keys
and dials), `neo` (8). It writes `deck/Dayboard.streamDeckProfile`; double-click
it and choose your deck. On fifteen keys and up the front page is the tabs, the
folders and the controls; smaller decks put the folders first and the rest one
folder deeper.

- `--install` writes straight into the app's `ProfilesV3` instead (restart the app).
- `--replace` overwrites an installed *Dayboard* profile in place, keeping the deck on it. **Quit the Stream Deck app first** — it writes profiles back out when it exits.
- `--device "@(1)[…]"` pins the device id; otherwise it is read off an existing profile for the same model.

The generated file carries a device serial, so it is generated on each machine
rather than committed.

## After changing the plugin

`npm run build`, then kill the plugin's node process — the Stream Deck app
starts a fresh one. `streamdeck restart` reports success without doing anything.

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*com.dayboard.deck*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

The vocabulary the deck speaks is `src/lib/deck.ts`; `tests/deck.test.ts` pins
it, and the tab lists there must match `src/app/page.tsx`.

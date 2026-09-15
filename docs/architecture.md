# How it fits together

```
data/settings.json         everything the setup guide writes; read fresh on every render
data/config/layers.json    the built-in layers (health, birthdays, personal)
data/layers/*.json         hand-curated events — the editor writes here
data/cache/upstream-*.json the team schedules, one file per team, refreshed daily
data/health.json           the exercise programme's history; its sessions become events
data/{todos,notes,water,watched}.json   what the board writes itself
data/{mail,packages}.json  what the pollers write
        |
        v
src/lib/settings.ts        loadSettings(): the store every module reads
src/lib/layers.ts          loads and merges the above; team layers are synthesised from settings
src/lib/recur.ts           expands repeating events; the board sees occurrences
src/lib/ics.ts             → /feeds/<token>/dayboard.ics, what the phone subscribes to
src/app/page.tsx           the triboard: a fixed stack, the centre tabs, the right tabs
src/components/setup/      the setup guide, a portal over the board
src/components/WatchPlayer.tsx   the one player, mounted outside every panel
src/components/AutoRefresh.tsx   the board refreshes itself every 30s
src/lib/memo.ts            decides how much of that reaches a provider
```

## The rules worth knowing

**Every write goes through a Server Action behind `todoGate()`** (`src/lib/todo-actions.ts`),
which asks whether the request came from this machine. It is not
authentication — `serve.ps1` binding 127.0.0.1 is the real fence — but it is
what makes a copy of the board somewhere else read-only. Actions return
`{ ok, error }` and never throw, so a failed button says so in its widget.

**Stores are three files each**: a pure half with no `next/*` imports
(`lib/water.ts`), a `"use server"` half (`lib/water-actions.ts`), and a CLI on
the same pure module (`scripts/water.ts`). Reads are uncached because the CLI
and the pollers write the same files. Saves are atomic (`lib/atomic.ts`).
`settings.ts` follows this exactly.

**Ids never move.** Phones match events by UID; a changed id is a duplicate.
Team fixtures hang off ESPN's event id; curated events are minted once by
`scripts/event.ts`.

**Times are stored with an offset and emitted as UTC**; the feed writes no
VTIMEZONE and no RRULE for timed series, so a clock change cannot move a weekly
meeting. `tests/recur.test.ts` and `tests/ics.test.ts` pin this.

**The zone is a setting.** `lib/runtime.ts` holds it on both sides of the wire:
the server from settings, the browser from a `data-tz` attribute on `<html>`.
Every date helper in `lib/time.ts` defaults to it.

**Panel children are positional.** The Nth tab is the Nth child. `page.tsx`
builds tabs and widgets as pairs so they cannot drift, and `src/lib/deck.ts`
keeps a second copy of the ids the Stream Deck may name.

**Nothing is fetched at request time that can be snapshotted.** Team schedules
come from `npm run refresh` into `data/cache/`; a flaky upstream degrades to last
week's fixtures. Weather and subscribed calendars are the exceptions, because a
stale one is worse than none, and they are served stale-while-revalidate.

**Live scores are the one request-time ESPN call**, only while a fixture is on,
on a 20-second memo, and a failure serves the last good slate.

**The player never moves.** Reparenting an iframe reloads it, so there is one
container, mounted once as a direct child of `.triboard`, and docked / corner /
filled is a CSS class plus four numbers. The Sports and Music tabs are real
Chrome windows made children of the board by `agent/stream`, sized to the same
stage.

**The board is drawn for 3440×1440 and scaled.** `lib/screen.ts` turns a screen
preset into a CSS `zoom` on `<html>`; `auto` measures the window before first
paint. Eighty measured pixel values in `globals.css` stay true because the
picture is the same picture.

**The wallpaper is a shader** (`components/Wallpaper.tsx`): a recreation of a
Wallpaper Engine preset, five tones as uniforms derived from the one chosen
ground colour, half resolution, twelve frames a second. Off, the flat ground
shows.

**Validate before every deploy.** `scripts/validate.ts` checks shapes, ids,
layers, and scans every tracked file for credentials and for any terms listed
in `.private-terms` (gitignored, one regex per line) — a maintainer's own
details go there, so a stray copy fails the build without the list itself
being published.

## Adding a widget

To the centre or right column: one pair in the arrays in `src/app/page.tsx` — a
`{ id, label }` and the component. Panel renders every widget on the server and
only decides which is visible. To the left stack: a `.widget` in the section;
the weather is the one flexible track.

## Adding a setting

A field in `src/lib/settings-schema.ts` (with a default), a control in the
matching section under `src/components/setup/`, and a `loadSettings()` read
where it is used. Secrets go in `SECRET_FIELDS` so `publicSettings()` masks them.

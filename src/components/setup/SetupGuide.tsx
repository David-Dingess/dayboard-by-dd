"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { PublicSettings } from "@/lib/settings";
import type { configured } from "@/lib/settings";
import { updateSettings } from "@/lib/settings-actions";
import { SCREEN_PRESETS, type ScreenPreset } from "@/lib/settings-schema";
import { lightness, wallpaperGreys, screenZoom } from "@/lib/screen";
import { selectTab } from "@/components/Panel";
import { closeSetup, goToSection, isSection, openSetup, seedSetup, useSetupState, type SectionId } from "./setup-store";
import { CheckButton, Command, Field, Lead, Lines, Note, SaveBar, Select, Steps, Text, Toggle } from "./fields";
import {
  AmazonSection,
  BirthdaysSection,
  CalendarsSection,
  DiscordSection,
  LocationSection,
  MailSection,
  SportsSection,
  TransitSection,
  TwitchSection,
  YouTubeSection,
} from "./sections";

/**
 * The setup guide: every way the board can be made yours, in one place, with
 * the manual steps written next to the fields they unlock.
 *
 * IT OPENS ON EVERY LAUNCH. Not on every render — the board re-renders itself
 * every thirty seconds and a menu that reappeared each time would be
 * unusable — but on every new window, which is what a board that starts
 * at logon means by "launch". sessionStorage is the boundary: it survives the
 * refresh tick and dies with the window. The "open on startup" toggle at the
 * end turns this off; the gear in the corner opens it any time; and
 * `/?setup=<section>` opens a section directly, which is how a widget with
 * nothing to show sends you to the field that would fix it.
 *
 * RENDERED INLINE, at the top of the page tree, not portaled: it is a fixed
 * overlay that covers whichever tab is up, it lives outside every Panel, and
 * the server renders it open for a `?setup=` link — which a portal onto
 * document.body cannot do.
 *
 * WHAT THE PAGE HOLDS. `settings` is the PUBLIC shape — every credential is
 * `{ set, hint }` — so nothing here can print a token. Sections keep a local
 * draft of their own section, save it whole through updateSettings, and the
 * Server Action's revalidatePath brings the saved state back down as props.
 */

export type Status = ReturnType<typeof configured>;

export interface SectionProps {
  settings: PublicSettings;
  status: Status;
  writable: boolean;
}

export type SetupGuideProps = SectionProps & {
  /** The `?setup=` section the page was opened on, if any — rendered open from the server. */
  initial?: SectionId | null;
};

const SEEN = "dayboard.setup.seen";

const TITLES: Record<SectionId, string> = {
  welcome: "Welcome",
  look: "Screen & look",
  location: "Location & weather",
  calendars: "Calendars",
  birthdays: "Birthdays",
  sports: "Sports",
  discord: "Discord",
  youtube: "YouTube",
  twitch: "Twitch",
  mail: "Email",
  amazon: "Packages",
  computer: "Computer & Now Playing",
  claude: "Claude usage",
  music: "Music",
  nudges: "Nudges & health",
  transit: "Subway (NYC)",
  streamdeck: "Stream Deck",
  finish: "Finish",
};

const ORDER: SectionId[] = [
  "welcome",
  "look",
  "location",
  "calendars",
  "birthdays",
  "sports",
  "discord",
  "youtube",
  "twitch",
  "mail",
  "amazon",
  "computer",
  "claude",
  "music",
  "nudges",
  "transit",
  "streamdeck",
  "finish",
];

/** configured / off / optional — what the dot beside a section name means. */
function dotFor(id: SectionId, status: Status, settings: PublicSettings): "on" | "off" | "none" {
  switch (id) {
    case "location":
      return status.location ? "on" : "off";
    case "calendars":
      return status.calendars ? "on" : "none";
    case "birthdays":
      return status.birthdays ? "on" : "none";
    case "sports":
      return status.sports ? "on" : "none";
    case "discord":
      return status.discord ? "on" : "none";
    case "youtube":
      return status.youtube ? "on" : "none";
    case "twitch":
      return status.twitch ? "on" : "none";
    case "mail":
      return settings.mail.enabled ? (status.mail ? "on" : "off") : "none";
    case "amazon":
      return settings.amazon.enabled ? (status.amazon ? "on" : "off") : "none";
    case "computer":
      return settings.pc.enabled ? "on" : "none";
    case "claude":
      return settings.claude.enabled ? "on" : "none";
    case "music":
      return settings.music.enabled ? "on" : "none";
    case "transit":
      return settings.transit.enabled ? (status.transit ? "on" : "off") : "none";
    default:
      return "none";
  }
}

export function SetupGuide({ initial = null, ...props }: SetupGuideProps) {
  seedSetup(initial);
  const { open, section } = useSetupState(initial);
  const router = useRouter();

  // Open on launch — once per window — or on request from the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    // `/?center=watch&right=pc` lands on those tabs: a link, a screenshot, a
    // deck macro can all name one. Cleared from the address afterwards so the
    // refresh tick does not keep re-selecting it.
    let landed = false;
    for (const side of ["center", "right"] as const) {
      const id = url.searchParams.get(side);
      if (id) {
        selectTab(side, id);
        url.searchParams.delete(side);
        landed = true;
      }
    }
    const asked = url.searchParams.get("setup");
    if (asked !== null) {
      // Already open from the server render (seedSetup); this only tidies the
      // address so the refresh tick does not keep re-seeding it.
      openSetup(isSection(asked) ? asked : "welcome");
      url.searchParams.delete("setup");
      window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
      return;
    }
    if (landed) {
      window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
    }
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN) === "1";
      sessionStorage.setItem(SEEN, "1");
    } catch {
      // A private window opens it every time, which is the safe default.
    }
    if (!seen && props.settings.setup.openOnLaunch) openSetup("welcome");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSetup();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const gear = (
    <button
      type="button"
      className="setup-gear"
      aria-label="Settings and setup guide"
      title="Settings"
      onClick={() => openSetup()}
    >
      <svg viewBox="0 0 16 16" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="8" cy="8" r="2.4" />
        <path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M3.5 12.5l1.3-1.3M11.2 4.8l1.3-1.3" />
      </svg>
    </button>
  );

  if (!open) return gear;

  const index = ORDER.indexOf(section);
  const prev = ORDER[index - 1];
  const next = ORDER[index + 1];

  return (
    <>
      {gear}
      <div className="setup-overlay" role="dialog" aria-modal="true" aria-label="Setup guide">
        <div className="setup-modal">
          <nav className="setup-nav" aria-label="Setup sections">
            <h2 className="setup-brand">
              Dayboard <span>by DD</span>
            </h2>
            <ul>
              {ORDER.map((id) => {
                const dot = dotFor(id, props.status, props.settings);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`setup-navitem${id === section ? " is-active" : ""}`}
                      onClick={() => goToSection(id)}
                    >
                      <span className={`setup-dot is-${dot}`} aria-hidden />
                      {TITLES[id]}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="setup-navfoot">Esc closes. Everything saves per section.</p>
          </nav>

          <div className="setup-body">
            <header className="setup-head">
              <h3>{TITLES[section]}</h3>
              <button type="button" className="setup-x" aria-label="Close" onClick={() => closeSetup()}>
                ✕
              </button>
            </header>
            <div className="setup-content" key={section}>
              <Section id={section} {...props} />
            </div>
            <footer className="setup-foot">
              <button type="button" className="setup-btn is-quiet" disabled={!prev} onClick={() => prev && goToSection(prev)}>
                ← {prev ? TITLES[prev] : ""}
              </button>
              <button
                type="button"
                className="setup-btn"
                onClick={() => {
                  if (next) goToSection(next);
                  else {
                    closeSetup();
                    router.refresh();
                  }
                }}
              >
                {next ? `${TITLES[next]} →` : "Done"}
              </button>
            </footer>
          </div>
        </div>
      </div>
    </>
  );
}

function Section({ id, ...props }: SectionProps & { id: SectionId }) {
  switch (id) {
    case "welcome":
      return <Welcome {...props} />;
    case "look":
      return <Look {...props} />;
    case "location":
      return <LocationSection {...props} />;
    case "calendars":
      return <CalendarsSection {...props} />;
    case "birthdays":
      return <BirthdaysSection {...props} />;
    case "sports":
      return <SportsSection {...props} />;
    case "discord":
      return <DiscordSection {...props} />;
    case "youtube":
      return <YouTubeSection {...props} />;
    case "twitch":
      return <TwitchSection {...props} />;
    case "mail":
      return <MailSection {...props} />;
    case "amazon":
      return <AmazonSection {...props} />;
    case "computer":
      return <Computer {...props} />;
    case "claude":
      return <Claude {...props} />;
    case "music":
      return <Music {...props} />;
    case "nudges":
      return <Nudges {...props} />;
    case "transit":
      return <TransitSection {...props} />;
    case "streamdeck":
      return <StreamDeck {...props} />;
    case "finish":
      return <Finish {...props} />;
  }
}

/* ------------------------------------------------------------- welcome --- */

function Welcome({ status }: SectionProps) {
  const done = Object.values(status).filter(Boolean).length;
  return (
    <>
      <Lead>
        Dayboard is a dashboard for your second monitor: your calendar in the middle, the weather,
        the trains, what is playing and who is in voice down the left, and a row of tabs on the
        right for the to-dos, the mail, the packages and the machine. It refreshes itself every
        thirty seconds and never asks you to press anything.
      </Lead>
      <p>
        This guide is the whole configuration. Work down the list on the left; each section says
        what it gives you, what you need, and has a <strong>Check</strong> button that tries it
        for real. Only <strong>Location</strong> is needed for the board to be useful; everything
        else is optional and turns on when you fill it in.
      </p>
      <Steps>
        <li>
          <strong>Screen &amp; look</strong> — pick your monitor size, turn the animated background
          on or off, choose a colour.
        </li>
        <li>
          <strong>Location</strong> — search for your city. Weather, sunrise and the clock follow it.
        </li>
        <li>
          <strong>Calendars, sports, Discord, YouTube, Twitch, email, packages</strong> — each is a
          few fields and a Check.
        </li>
        <li>
          <strong>Computer</strong> — the small local agent that reads what is playing and how hot
          the machine is. Optional, and Windows only.
        </li>
        <li>
          <strong>Finish</strong> — one PowerShell command registers the board to start at logon.
        </li>
      </Steps>
      <Note tone={done > 2 ? "good" : "plain"}>
        {done} of {Object.keys(status).length} things are configured. Nothing here is committed to
        git: it all lives in <code>data/settings.json</code>, which is ignored.
      </Note>
    </>
  );
}

/* ---------------------------------------------------------------- look --- */

const PRESET_LABELS: Record<ScreenPreset, string> = {
  auto: "Auto (measure the window)",
  "3440x1440": "3440 × 1440 ultrawide — the original",
  "2560x1440": "2560 × 1440",
  "2560x1080": "2560 × 1080 ultrawide",
  "1920x1080": "1920 × 1080",
  "1920x1200": "1920 × 1200",
  "3840x2160": "3840 × 2160 (4K)",
};

function Look({ settings, writable }: SectionProps) {
  const [board, setBoard] = useState(settings.board);
  const [look, setLook] = useState(settings.appearance);
  const dirty = JSON.stringify(board) !== JSON.stringify(settings.board) || JSON.stringify(look) !== JSON.stringify(settings.appearance);

  // Immediate, before the save: the ground and the zoom are one attribute each.
  const preview = (next: typeof look, screen: ScreenPreset) => {
    const html = document.documentElement;
    const greys = wallpaperGreys(next.background);
    html.style.setProperty("--bg-user", next.background);
    html.style.setProperty("--bg-ground", next.wallpaper ? greys.seam : next.background);
    html.dataset.wallpaper = next.wallpaper ? "on" : "off";
    const zoom = screenZoom(screen);
    if (zoom !== null) html.style.setProperty("--board-zoom", String(zoom));
    else {
      const z = Math.max(0.5, Math.min(2, Math.min(window.innerHeight / 1440, window.innerWidth / 2560)));
      html.style.setProperty("--board-zoom", z.toFixed(3));
    }
  };

  const tooLight = lightness(look.background) > 35;

  return (
    <>
      <Lead>
        The board was drawn for a 3440 × 1440 ultrawide and every other size is that board scaled
        to fit. Pick the monitor it lives on, or leave it on Auto and it measures the window.
      </Lead>
      <Field label="Screen">
        <Select
          value={board.screen}
          disabled={!writable}
          options={SCREEN_PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] }))}
          onChange={(screen) => {
            setBoard({ ...board, screen });
            preview(look, screen);
          }}
        />
      </Field>
      <Field label="Port" hint="Where the server listens. Change it only if 6767 is taken; the Finish step re-registers everything.">
        <Text
          type="number"
          value={String(board.port)}
          disabled={!writable}
          onChange={(v) => setBoard({ ...board, port: Number(v) || 6767 })}
        />
      </Field>
      <Toggle
        checked={look.wallpaper}
        disabled={!writable}
        label="Animated background — slow terraces of colour behind the panels"
        onChange={(wallpaper) => {
          const next = { ...look, wallpaper };
          setLook(next);
          preview(next, board.screen);
        }}
      />
      <Field
        label="Background colour"
        hint={
          tooLight
            ? "That is light enough to make the text hard to read. The board's palette assumes a dark ground."
            : "Dark works best. The panels, the animated background and the seams all derive from this one colour."
        }
      >
        <span className="setup-colour">
          <input
            type="color"
            value={look.background}
            disabled={!writable}
            onChange={(e) => {
              const next = { ...look, background: e.target.value };
              setLook(next);
              preview(next, board.screen);
            }}
          />
          <Text
            mono
            value={look.background}
            disabled={!writable}
            onChange={(v) => {
              if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
              const next = { ...look, background: v };
              setLook(next);
              preview(next, board.screen);
            }}
          />
          {["#111111", "#0d0f14", "#14100c", "#0b1410", "#140b12"].map((hex) => (
            <button
              key={hex}
              type="button"
              className="setup-swatch"
              style={{ background: hex }}
              aria-label={`Use ${hex}`}
              disabled={!writable}
              onClick={() => {
                const next = { ...look, background: hex };
                setLook(next);
                preview(next, board.screen);
              }}
            />
          ))}
        </span>
      </Field>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ board, appearance: look })} />
    </>
  );
}

/* ------------------------------------------------------------ computer --- */

function Computer({ settings, writable }: SectionProps) {
  const [pc, setPc] = useState(settings.pc);
  const dirty = JSON.stringify(pc) !== JSON.stringify(settings.pc);
  return (
    <>
      <Lead>
        A small local program, <em>the PC agent</em>, reads what Windows is playing (with album
        art and a live EQ), the CPU, GPU, memory, fans, drives and network, and — through
        Voicemeeter, if you run it — switches headphones and speakers and mutes the mic. The board
        reads it over loopback. Nothing leaves the machine.
      </Lead>
      <Toggle checked={pc.enabled} disabled={!writable} label="Show Now Playing and the Computer tab" onChange={(enabled) => setPc({ ...pc, enabled })} />
      <Field label="Now Playing follows" hint='"any" follows whatever Windows calls current. A name like "Spotify" or "AppleMusic" pins it to one app so a video in a browser tab cannot hijack the panel.'>
        <Text value={pc.nowPlayingApp} disabled={!writable} onChange={(nowPlayingApp) => setPc({ ...pc, nowPlayingApp })} />
      </Field>
      <Field label="Headphone device names" hint="Voicemeeter only. Fragments of the device names on your A1/A2 buses, one per line; the first bus matching one is the headphones.">
        <Lines value={pc.headphoneNames} rows={2} placeholder={"focusrite\nscarlett"} disabled={!writable} onChange={(headphoneNames) => setPc({ ...pc, headphoneNames })} />
      </Field>
      <Field label="Speaker device names">
        <Lines value={pc.speakerNames} rows={2} placeholder={"realtek\nspeakers"} disabled={!writable} onChange={(speakerNames) => setPc({ ...pc, speakerNames })} />
      </Field>
      <Field label="Agent URL" hint="Keep the literal 127.0.0.1: Chrome exempts the loopback address from mixed-content blocking, and the hostname has not always been treated the same.">
        <Text mono value={pc.agentUrl} disabled={!writable} onChange={(agentUrl) => setPc({ ...pc, agentUrl })} />
      </Field>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ pc })} />

      <h4>Build and start it</h4>
      <Steps>
        <li>
          Install the <strong>.NET 8 SDK</strong> (dotnet.microsoft.com). Windows only.
        </li>
        <li>
          Build it once, from the repo folder: <Command>{"cd agent\\nowplaying; dotnet publish -c Release -o dist"}</Command>
        </li>
        <li>
          Register it to start at logon. Temperatures need a kernel driver, so this one wants an{" "}
          <strong>elevated</strong> PowerShell (right-click → Run as administrator):
          <Command>{"powershell -ExecutionPolicy Bypass -File scripts\\setup.ps1 -Agent"}</Command>
        </li>
        <li>Press Check. Load and memory arrive either way; temperatures and fans only when elevated.</li>
      </Steps>
      <CheckButton name="pc" label="Check the agent" />
      <Note>
        Rebuild after any change to <code>agent/nowplaying</code>. The Computer tab says so out loud
        when the running agent is older than the routes the board expects.
      </Note>
    </>
  );
}

/* -------------------------------------------------------------- claude --- */

function Claude({ settings, writable }: SectionProps) {
  const [claude, setClaude] = useState(settings.claude);
  const dirty = claude.enabled !== settings.claude.enabled;
  return (
    <>
      <Lead>
        If you use Claude Code, the board shows how much of the session and weekly limits is left,
        as three thin bars beside the water bottle — and a small cat on a shelf that walks while
        Claude is working, waves when it is waiting on you, and sleeps otherwise.
      </Lead>
      <Toggle checked={claude.enabled} disabled={!writable} label="Show the usage bars and the cat" onChange={(enabled) => setClaude({ enabled })} />
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ claude })} />
      <h4>What it needs</h4>
      <Steps>
        <li>The PC agent from the Computer section, running. The numbers come through it.</li>
        <li>
          The <strong>Claude CLI</strong>, signed in: run <code>claude</code> once in a terminal and log
          in. The desktop app alone does not write the token the agent reads.
        </li>
      </Steps>
      <CheckButton name="claude" label="Check Claude" />
      <Note>
        Nothing is sent anywhere: the agent reads the CLI&apos;s own credentials file and asks
        Anthropic for the usage numbers the CLI itself shows. The cat reads the CLI&apos;s session
        files to know whether something is running.
      </Note>
    </>
  );
}

/* --------------------------------------------------------------- music --- */

const MUSIC_PRESETS = [
  { value: "https://music.apple.com/", label: "Apple Music" },
  { value: "https://music.youtube.com/", label: "YouTube Music" },
  { value: "https://open.spotify.com/", label: "Spotify" },
  { value: "https://listen.tidal.com/", label: "Tidal" },
  { value: "https://soundcloud.com/", label: "SoundCloud" },
];

function Music({ settings, writable }: SectionProps) {
  const [music, setMusic] = useState(settings.music);
  const dirty = JSON.stringify(music) !== JSON.stringify(settings.music);
  return (
    <>
      <Lead>
        The Music tab is your music service&apos;s own web player, inside the board: a separate
        Chrome with its own profile, framed so it looks like a panel. Sign in once and it stays
        signed in. Windows only — it needs the small window helper the board builds itself.
      </Lead>
      <Toggle checked={music.enabled} disabled={!writable} label="Show the Music tab" onChange={(enabled) => setMusic({ ...music, enabled })} />
      <Field label="Service">
        <Select
          value={MUSIC_PRESETS.some((p) => p.value === music.home) ? music.home : "custom"}
          disabled={!writable}
          options={[...MUSIC_PRESETS, { value: "custom", label: "Other (type the URL below)" }]}
          onChange={(v) => v !== "custom" && setMusic({ ...music, home: v })}
        />
      </Field>
      <Field label="Home page" hint="Any of Apple Music, YouTube Music, Spotify, Tidal, SoundCloud, Deezer, Amazon Music or Bandcamp, over https.">
        <Text mono type="url" value={music.home} disabled={!writable} onChange={(home) => setMusic({ ...music, home })} />
      </Field>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ music })} />
      <h4>Signing in</h4>
      <Steps>
        <li>Open the Music tab on the board. The first time, it opens the service&apos;s sign-in page.</li>
        <li>Sign in inside it like any browser. The login lives in its own profile and nowhere else.</li>
        <li>
          For the browser&apos;s own settings (password sync, clearing a site), open the profile as an
          ordinary window while the board&apos;s copy is closed: <Command>{"powershell -File scripts\\music.ps1"}</Command>
        </li>
      </Steps>
    </>
  );
}

/* -------------------------------------------------------------- nudges --- */

function Nudges(_: SectionProps) {
  return (
    <>
      <Lead>
        The Health tab is a 52-week strength and mobility programme with drawn exercise
        animations, a walk timer, a five-minute chair routine, a 20/20/20 eye break that blacks
        out the screen for twenty seconds every twenty minutes, and <strong>nudges</strong>: a
        chime, a pulse on the tab and a Windows notification at the times you choose.
      </Lead>
      <h4>Your own nudges</h4>
      <p>
        Press the <strong>bell</strong> in the bottom-left row of the board. Every nudge is listed
        there: the programme&apos;s own (walk, strength, last call, chair) can be retimed or turned
        off, and you can add any reminder of your own — a label, a time, every day or on chosen
        weekdays, or just once today. &ldquo;Take the bins out&rdquo; at 19:30 on Tuesdays is one
        row.
      </p>
      <h4>Quiet hours, eye breaks, the programme</h4>
      <p>
        On the <strong>Health</strong> tab, the settings card at the bottom holds quiet hours
        (nothing chimes inside them), the eye-break interval and its own quiet hours, the sound,
        and the programme&apos;s start date. Restarting the programme is there too.
      </p>
      <h4>Letting it reach you</h4>
      <Steps>
        <li>
          Press <strong>Turn on alerts</strong> when the banner appears at the bottom of the board.
          That one click arms the chime and asks Chrome for notification permission — a browser
          will only do either from a real click.
        </li>
        <li>
          Notifications are per Chrome profile and per port. The board&apos;s own Chrome profile is
          separate from the one you browse with, so grant it on the board itself.
        </li>
      </Steps>
      <Note>
        Test the eye break without waiting twenty minutes: open the board as{" "}
        <code>/?eye=30s</code> and the whole cycle runs in seconds.
      </Note>
    </>
  );
}

/* ---------------------------------------------------------- stream deck --- */

function StreamDeck(_: SectionProps) {
  return (
    <>
      <Lead>
        A Stream Deck plugin drives the board from your desk: switch tabs, play the third video
        or the second live stream, open a team&apos;s streaming site, log a glass of water, toggle
        headphones and speakers, mute the mic, turn the alerts on, reset the board. The keys draw
        themselves from the board&apos;s own state every few seconds.
      </Lead>
      <h4>Install the plugin</h4>
      <Steps>
        <li>Install the Stream Deck app (Elgato) and plug the deck in.</li>
        <li>
          Build and link the plugin, from the repo folder:
          <Command>{"cd deck; npm install; npm run build; npm run link"}</Command>
          <code>npm run link</code> makes a symlink into the Stream Deck plugins folder. Windows
          only creates one with Developer Mode on (Settings → System → For developers) or from an
          elevated shell.
        </li>
        <li>
          <strong>Quit the Stream Deck app from the tray and reopen it.</strong> It only scans for
          plugins at startup, and a freshly linked one is invisible until you do.
        </li>
      </Steps>
      <h4>Add the profile</h4>
      <Steps>
        <li>
          Generate a profile for your model:
          <Command>{"cd deck; npm run profile -- --model mk2"}</Command>
          <code>mk2</code> is the 15-key Stream Deck MK.2 (also the original 15-key);{" "}
          <code>mini</code> (6 keys), <code>xl</code> (32), <code>plus</code> (8 keys and dials) and{" "}
          <code>neo</code> (8) are the others. It writes{" "}
          <code>deck/Dayboard.streamDeckProfile</code>.
        </li>
        <li>
          Double-click that file. The Stream Deck app asks which device; pick yours. The profile
          appears as <strong>Dayboard</strong> with the tabs across the top, the Live, Videos and
          Sports folders in the middle, and water, alerts, output, mute and reset along the bottom.
          Smaller decks put the same keys in folders.
        </li>
        <li>
          If the import is refused, write it straight into the app&apos;s profiles instead:
          <Command>{"cd deck; npm run profile -- --model mk2 --install"}</Command>
          then quit and reopen the Stream Deck app.
        </li>
      </Steps>
      <h4>Worth knowing</h4>
      <Steps>
        <li>
          The tab keys never light up — which tab a panel shows lives in the board&apos;s browser
          and is never sent anywhere. Pressing one is harmless if it is already showing.
        </li>
        <li>
          The Videos and Live keys hold a <em>position</em>, not a video: key 3 plays whatever is
          third at the moment you press it.
        </li>
        <li>
          After editing the plugin&apos;s source, <code>npm run build</code> then kill its node
          process — the Stream Deck app starts a fresh one. Its own restart command reports success
          without doing anything.
        </li>
        <li>
          The plugin talks to <code>http://127.0.0.1:6767</code>. If you changed the port, set{" "}
          <code>DAYBOARD_URL</code> in the Stream Deck app&apos;s environment or edit{" "}
          <code>deck/src/board.ts</code>.
        </li>
      </Steps>
    </>
  );
}

/* -------------------------------------------------------------- finish --- */

function Finish({ settings, status, writable }: SectionProps) {
  const [openOnLaunch, setOpenOnLaunch] = useState(settings.setup.openOnLaunch);
  const dirty = openOnLaunch !== settings.setup.openOnLaunch;
  const rows: [string, boolean][] = [
    ["Location & weather", status.location],
    ["Calendars", status.calendars],
    ["Birthdays", status.birthdays],
    ["Sports", status.sports],
    ["Discord", status.discord],
    ["YouTube", status.youtube],
    ["Twitch", status.twitch],
    ["Email", status.mail],
    ["Packages", status.amazon],
    ["Computer", status.pc],
    ["Claude", status.claude],
    ["Music", status.music],
    ["Subway", status.transit],
    ["Phone calendar feed", status.feed],
  ];
  return (
    <>
      <Lead>Here is where things stand, and the one command that makes the board start with Windows.</Lead>
      <ul className="setup-checklist">
        {rows.map(([label, ok]) => (
          <li key={label} className={ok ? "is-on" : ""}>
            <span className={`setup-dot is-${ok ? "on" : "none"}`} aria-hidden />
            {label}
          </li>
        ))}
      </ul>
      <h4>Start at logon</h4>
      <p>
        From the repo folder, in PowerShell. It builds the board, registers the server, the
        board window, a daily schedule refresh, and — only for the ones you turned on — the mail
        and package pollers. Run it again after changing the port or enabling an integration.
      </p>
      <Command>{"powershell -ExecutionPolicy Bypass -File scripts\\setup.ps1"}</Command>
      <Note>
        Always through <code>powershell -ExecutionPolicy Bypass -File</code>, never by
        double-clicking: a fresh Windows refuses a <code>.ps1</code> run directly. The tasks it
        registers carry the same flag, so the board starts whatever the policy says.
      </Note>
      <h4>This guide</h4>
      <Toggle checked={openOnLaunch} disabled={!writable} label="Open this guide every time the board launches" onChange={setOpenOnLaunch} />
      <p>
        Off, the gear in the bottom-right corner still opens it any time, and so does{" "}
        <code>/?setup</code> on the address.
      </p>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ setup: { ...settings.setup, openOnLaunch } })} />
    </>
  );
}

export function SetupLink({ section, children }: { section: SectionId; children: ReactNode }) {
  return (
    <button type="button" className="setup-link" onClick={() => openSetup(section)}>
      {children}
    </button>
  );
}

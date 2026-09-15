"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { selectTab, usePanelTab } from "@/components/Panel";
import {
  clearWatching,
  homeFor,
  otherLane,
  recallPosition,
  rememberPosition,
  setExpanded,
  useExpanded,
  useWatching,
  writeWatching,
  type Lane,
} from "@/components/watching";
import {
  mountStream,
  mountTwitch,
  mountYouTube,
  type DeckPlayer,
  type PlayState,
} from "@/components/players";
import { markWatched } from "@/lib/watch-actions";
import { nextAfter } from "@/components/queue";
import { registerHush } from "@/components/player-hush";
import { publishLane, takeFocus, useSilenced } from "@/components/audio-focus";
import { parentHosts } from "@/lib/embed";
import {
  clampPip,
  commitCorner,
  defaultCornerPoint,
  defaultPipWidth,
  maxPipWidth,
  pipHeightFor,
  PIP_MIN_WIDTH,
  previewCorner,
  recallMuted,
  rememberMuted,
  useCorner,
  type Corner,
  type PipPoint,
} from "@/components/pip-position";

/**
 * A player on the board, and the only thing that is allowed to move it.
 *
 * THERE ARE TWO OF THESE, ONE PER LANE (see watching.ts). The "main" one plays
 * YouTube and Twitch; the "stream" one drives the Sports tab's stream window.
 * Everything below is written about one of them, and holds for each, because
 * nothing here is shared between them except the tab they read.
 *
 * THE WHOLE DESIGN COMES OUT OF ONE FACT: moving a player's container in the DOM
 * reloads it. So there is exactly one container, mounted once, right here as a
 * direct child of the triboard — above every panel, outside every widget slot,
 * with no props and no key. Docked, mini and filled are a CSS class and four
 * numbers; nothing is ever reparented, so nothing ever restarts.
 *
 * That is also what survives AutoRefresh. A refresh tick re-runs every server
 * component on the route and merges the payload in; React keeps a node when its
 * component holds the same type, key and position, and this one does. The player
 * is torn down for exactly one reason — you picked something else — which is
 * why the mounting effect depends on the store entry and on nothing else.
 *
 * WHY IT IS NOT INSIDE THE WATCH TAB. Panel hides an inactive tab with
 * display:none, so a player living in that slot would have no box to measure, no
 * visible mini state, and would get render-throttled by the browser the moment
 * you looked at the calendar. Instead the tab holds an empty stage —
 * [data-watchstage] — and this thing sits on top of it in fixed viewport
 * coordinates, the same trick and the same reasoning as the subway status card.
 *
 * THINGS THAT LOOK LIKE IMPROVEMENTS AND ARE NOT: a portal swapped between a
 * docked container and a mini one (changing a portal's container reparents the
 * node — it reloads); two players toggled with CSS (two audio streams, and one
 * restarts on every switch); placing it in the grid as a third column child
 * (free geometry, but it needs magic offsets for the tab row and the widget head
 * that break silently the day either changes height).
 */

type Mode = "mini" | "docked" | "filled";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M5 3.4 12.2 8 5 12.6Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M5.4 3.4v9.2M10.6 3.4v9.2" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M3 6.2h2.2L8.4 3.6v8.8L5.2 9.8H3Z" />
      <path d="m10.8 6.4 3 3.2M13.8 6.4l-3 3.2" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M3 6.2h2.2L8.4 3.6v8.8L5.2 9.8H3Z" />
      <path d="M11 5.6a3.4 3.4 0 0 1 0 4.8" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13.2 2.6v3.2H10" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M6.2 2.8H2.8v3.4M9.8 2.8h3.4v3.4M13.2 9.8v3.4H9.8M6.2 13.2H2.8V9.8" />
    </svg>
  );
}

/**
 * Four corners folding inwards. Every elbow belongs at the INNER point — the one
 * nearest the middle — with both arms reaching out to the edges; that is what
 * makes it read as the opposite of ExpandIcon, whose elbows all sit on the
 * outside. Three of these were right and the bottom-right one was drawn the
 * expand way round, which is a thing you see immediately and cannot un-see.
 */
function ShrinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M2.8 6.2h3.4V2.8M13.2 6.2H9.8V2.8M13.2 9.8H9.8v3.4M6.2 13.2V9.8H2.8" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M6.2 3.2h6.6v6.6" />
      <path d="M12.8 3.2 6 10" />
      <path d="M11 9.4v3.4H3.2V5h3.4" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M9.8 3.4 5.2 8l4.6 4.6" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M2.8 7.6 8 3.2l5.2 4.4" />
      <path d="M4.4 6.4v6.4h7.2V6.4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function WatchPlayer({ lane = "main" }: { lane?: Lane }) {
  const { entry, autoplay } = useWatching(lane);
  const tab = usePanelTab("center");
  const expanded = useExpanded(lane);
  // Whether the other player is also in the corner, so the two stack.
  const { entry: otherEntry } = useWatching(otherLane(lane));

  const dockRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<DeckPlayer | null>(null);

  const [state, setState] = useState<PlayState>("idle");
  const [muted, setMuted] = useState(false);
  // playerRef is a ref, so nothing re-renders when it fills in. The transport
  // buttons need to know, though: until the player exists they are attached to
  // nothing, and a dead-looking button beats one that swallows the click.
  const [ready, setReady] = useState(false);
  // Tagged with the mode it was measured for, so a mode whose target could not
  // be found falls back to the corner rather than inheriting the last mode's
  // rectangle. It also means nothing has to null this out on the way past.
  const [box, setBox] = useState<(Box & { mode: Mode }) | null>(null);
  // Which key has already been advanced past. YouTube can report state 0 more
  // than once for one ending, and skipping two videos on one is not recoverable
  // — they would both be marked watched and gone from the list.
  const advanced = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The corner both players share: where it is parked and how big it is. See
  // pip-position.ts. A server render has none, so there is no hydration mismatch.
  const corner = useCorner();
  const drag = useRef<{ dx: number; dy: number; ox: number; oy: number } | null>(null);
  const resize = useRef<{ x: number; width: number; origin: PipPoint } | null>(null);
  // The latest drag or resize, to write down when it is released.
  const pending = useRef<Corner | null>(null);
  // The parked spot is under the other player right now, so this one uses its
  // default corner instead. See the effect that sets it.
  const [yield_, setYield] = useState(false);
  // Re-render on a window resize, so a parked corner is clamped back on screen.
  const [, setViewport] = useState(0);
  useEffect(() => {
    const bump = () => setViewport((n) => n + 1);
    window.addEventListener("resize", bump);
    return () => window.removeEventListener("resize", bump);
  }, []);

  /**
   * THREE REASONS TO BE SILENT, ONE MUTE ON THE PLAYER.
   *
   *   muted     the speaker button — your choice, remembered per thing
   *   hushed    the eye break, for as long as the screen is black
   *   silenced  the other player is on the big screen with its sound on
   *
   * The player is told the sum, and TOLD AGAIN whenever it disagrees. That is the
   * fix for a muted Twitch stream coming back loud after an eye break: the old
   * code set the mute once and trusted the embed to keep it, and a Twitch embed
   * that reloads its own player (an ad break does it) forgets.
   */
  const [hushed, setHushed] = useState(false);
  const silenced = useSilenced(lane);
  const applied = useRef<boolean | null>(null);
  const settleUntil = useRef(0);
  const restartedAt = useRef(0);
  const lastState = useRef<PlayState>("idle");

  /**
   * A PARKED CORNER PLAYER GETS OUT OF THE OTHER PLAYER'S WAY.
   *
   * Found on the board: the Twitch mini had been dragged into the centre panel,
   * which was a fine place for it until the match docked in the Sports stage
   * right over that spot. The stream is a real window, and a real window is
   * drawn over every element of the page, so the Twitch player simply vanished.
   *
   * So while the parked spot overlaps the other player's box, this one sits in
   * the default corner, which is over the right-hand column and clear of every
   * stage. The spot itself is not forgotten: the moment the overlap ends it goes
   * back there.
   *
   * WHO YIELDS: a corner player always yields to a docked or filled one. When
   * both are in the corner, only the stream does, because it is the window
   * that would do the covering.
   *
   * Polled rather than observed, because what moves is the OTHER player's box,
   * which this component has no ref to. A rect read four times a second is
   * nothing, and setState with an unchanged value renders nothing.
   */
  useEffect(() => {
    const check = () => {
      const me = dockRef.current;
      const other = document.querySelector<HTMLElement>(
        `.watchdock[data-lane="${otherLane(lane)}"]`,
      );
      const point = corner.point;
      // Only against a player that is docked or filled. Two corner players
      // stack instead; see the render.
      if (!entry || !point || !me || !me.classList.contains("is-mini") || !other || other.classList.contains("is-mini")) {
        setYield(false);
        return;
      }
      const b = other.getBoundingClientRect();
      const width = me.offsetWidth;
      const height = me.offsetHeight;
      const at = clampPip(point, width, height);
      setYield(at.left < b.right && at.left + width > b.left && at.top < b.bottom && at.top + height > b.top);
    };
    check();
    const timer = setInterval(check, 250);
    return () => clearInterval(timer);
  }, [entry, corner.point, lane]);

  // Which tab is showing decides this, never the measurement: a zero-sized rect
  // is what a display:none slot reports, and inferring the mode from it would
  // flash a collapsed player on every switch.
  //
  // THREE TABS CARRY A STAGE. Watch (id "watch") and Sports have their own,
  // and Health has one at the bottom of its widget for follow-along videos — a
  // workout you follow belongs in the panel you are reading the exercise from,
  // not in the corner.
  //
  // BUT ONLY THE TAB IT CAME FROM STAGES IT. There is one player and it is never
  // reparented, so it used to fill whichever staged tab was showing: open Health
  // mid-VOD and the game was sitting in the middle of the workout panel,
  // on top of the warm-up video you went there to find. Every part of that
  // worked as designed and all of it read as a bug. A video docks in the tab
  // that started it and plays in the corner everywhere else — including in the
  // other staged tab, which is the whole point.
  const kind = entry?.kind ?? null;
  const home = entry ? homeFor(entry) : lane === "stream" ? "sports" : "watch";
  const staged = tab === home;
  // Read by the fullscreen listener below, which is registered once and outlives
  // any one entry — the same ref-not-dep shape EyeBreak uses for its settings.
  // Written in an effect rather than during render: a ref assignment in a render
  // body is exactly what react-hooks/refs is there to catch.
  const homeRef = useRef(home);
  useEffect(() => {
    homeRef.current = home;
  }, [home]);
  const mode: Mode = !staged ? "mini" : expanded ? "filled" : "docked";
  const onBigScreen = entry !== null && tab !== null && mode !== "mini" && box?.mode === mode;
  useEffect(() => {
    if (onBigScreen) takeFocus(lane);
  }, [onBigScreen, lane]);

  /**
   * Build the player, and rebuild it only when the selection genuinely changes.
   *
   * `entry` is safe as a dependency because useWatching memoises on the raw
   * storage string — a refresh tick re-renders this component with the identical
   * object, so this effect does not run and the player does not blink. Clicking
   * the same video again writes a new timestamp, which is a new object, which
   * restarts it. That is the behaviour you want from both.
   */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !entry) return;

    let cancelled = false;
    let built: DeckPlayer | null = null;
    setFailed(false);
    setReady(false);
    setMuted(recallMuted(entry.key, lane));
    setHushed(false);
    applied.current = null;
    setState(autoplay ? "playing" : "idle");

    /**
     * When a video runs out, the next unwatched one starts.
     *
     * PLAYING TO COMPLETION MARKS IT WATCHED, where opening it does not — and
     * those two rules come out of one principle rather than contradicting each
     * other. VideoList stopped marking on open because a click became "put this
     * on", something you might do to three things before settling; the board
     * marks what it OBSERVED, never what it assumed, and reaching the end is the
     * one signal that is not an assumption. It is also load-bearing: without the
     * mark, the queue hands back the same video forever.
     *
     * ORDER IS THE WHOLE THING. `next` is read BEFORE the mark, because marking
     * removes this video from the published list and takes its position with it.
     *
     * The new entry carries a fresh `at`, which makes autoplay true
     * (watching.ts) and tears down and rebuilds this player — the same path a
     * click takes, and the reason this is written to the store rather than
     * loaded into the existing player.
     *
     * IT DOES NOT STEAL THE PANEL. No selectTab: a queue that yanks the centre
     * column to Watch while you are reading the calendar is a board you stop
     * trusting. In the corner player it just keeps playing, which is what the
     * corner player is for. It stops on its own when the queue runs out —
     * nothing here starts something the click that began the run did not.
     */
    const advance = () => {
      // A Twitch stream ending is a broadcaster going to bed, not a queue item
      // finishing. This gate, not the event mapping, is what makes that safe.
      if (entry.kind !== "youtube" || advanced.current === entry.key) return;
      advanced.current = entry.key;
      const next = nextAfter(entry.key);
      // Fire and forget: this is a player callback, not a click, and there is
      // nothing on screen waiting on the answer. A refused write (the deployed
      // copy, where todoGate says no) just leaves the video on the list, which
      // is the same thing that happened before there was a list to write to.
      void markWatched(entry.key);
      if (next) writeWatching({ ...next, at: Date.now() });
    };

    const opts = {
      autoplay,
      parents: parentHosts(process.env.NEXT_PUBLIC_SITE_URL, window.location.hostname),
      // Where you got to last time. Zero for anything new, and for Twitch, which
      // has no such thing.
      startAt: recallPosition(entry.key),
    };
    const pending =
      entry.kind === "youtube"
        ? mountYouTube(mount, entry.key, opts)
        : entry.kind === "stream"
          ? mountStream(mount, entry.key, entry.channel || "the stream", opts)
          : mountTwitch(mount, entry.key, opts);

    pending
      .then((player) => {
        if (cancelled) {
          player.destroy();
          return;
        }
        built = player;
        playerRef.current = player;
        restartedAt.current = Date.now();
        player.onState((next) => {
          // Starting to play again is when an embed that reloaded itself has
          // just forgotten its mute. Noted, so the check below does not mistake
          // that reset for you unmuting it.
          if (next === "playing" && lastState.current !== "playing") restartedAt.current = Date.now();
          lastState.current = next;
          setState(next);
          if (next === "ended") advance();
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    /**
     * Note the position often enough that a crash costs seconds, not minutes.
     *
     * On a timer rather than on every state change, because the thing worth
     * recording is a video quietly running — nothing fires an event for that.
     * `pagehide` catches the reload, which is the case that prompted this;
     * cleanup catches switching to something else, and runs before the player is
     * destroyed, which is the only moment it can still be asked.
     */
    const key = entry.key;
    const save = () => {
      const at = playerRef.current?.progress();
      if (at) rememberPosition(key, at.seconds, at.duration);
    };
    const ticker = setInterval(save, 5000);
    window.addEventListener("pagehide", save);

    return () => {
      clearInterval(ticker);
      window.removeEventListener("pagehide", save);
      save();
      cancelled = true;
      setReady(false);
      playerRef.current = null;
      built?.destroy();
    };
    // `lane` never changes for a given player; it is here to satisfy the rule,
    // not because anything re-mounts on it.
  }, [entry, autoplay, lane]);

  /**
   * Follow whatever the player is supposed to be sitting on.
   *
   * Docked means the stage inside the Watch tab; filled means the whole centre
   * panel body, which is what "fullscreen" here means — the panel, not the
   * screen. The stage is rendered by a server component so there is no ref to
   * pass across; it is found by attribute instead, and re-found whenever the
   * mode changes, because the box it reports while hidden is all zeros.
   *
   * The scroll listener is in the capture phase because under 1400px the board
   * collapses to a single column and the page itself scrolls.
   */
  useLayoutEffect(() => {
    if (mode === "mini" || !entry) return;

    // Scoped to the slot that is actually showing: there are two stages in the
    // DOM now, and Panel hides the inactive one with display:none, so the
    // unscoped selector would happily measure a box of zeros.
    const selector =
      mode === "filled" ? '[data-panel="center"]' : ".widget-slot.is-active [data-watchstage]";
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) return;

    const measure = () => {
      const r = target.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      setBox({ mode, left: r.left, top: r.top, width: r.width, height: r.height });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // `tab` as well as `mode`: Watch → Health is docked → docked, so without it
    // this would keep measuring the stage it can no longer see and the player
    // would sit over the wrong panel.
  }, [mode, entry, tab]);

  /**
   * Fullscreen goes to the panel, not the screen.
   *
   * players.ts already takes the permission off the iframe and hides YouTube's
   * own button, but that cannot cover pressing `f` with focus inside the player.
   * This can: the top-level document is always allowed to leave fullscreen, so
   * whatever route got there, it comes straight back out and expands the panel
   * instead. It is the mechanism; the rest is just so it rarely has to fire.
   */
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement;
      const dock = dockRef.current;
      if (!active || !dock || !dock.contains(active)) return;
      void document.exitFullscreen().catch(() => {});
      selectTab("center", homeRef.current);
      setExpanded(true, lane);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [lane]);

  /**
   * Lend the eye break a way to quiet this.
   *
   * A video is paused and put back; a stream is muted and unmuted, because a
   * live broadcast cannot wait twenty-five seconds for anybody. See
   * components/player-hush.ts for why the undo is the return value rather than a
   * flag, and why something already paused or already muted by hand is left
   * exactly as it is.
   *
   * Re-registering on every state change is free — the takeover holds the
   * restore function it was handed, not this closure, so a pause that lands here
   * as `state === "paused"` cannot undo its own undo.
   */
  // Tell the other player what this one has on and whether it is muted, so the
  // big-screen rule can be worked out. Gone when this lane is empty.
  useEffect(() => {
    publishLane(lane, entry !== null, muted);
  }, [lane, entry, muted]);
  useEffect(() => () => publishLane(lane, false, false), [lane]);

  const effective = muted || hushed || silenced;

  useEffect(() => {
    const player = playerRef.current;
    if (!ready || !player || !entry) return;
    const settle = kind === "stream" ? 4500 : 2500;
    const push = (value: boolean) => {
      player.setMuted(value);
      applied.current = value;
      // Every embed answers a little late; a reading taken inside this window
      // is the old state, not a change.
      settleUntil.current = Date.now() + settle;
    };
    if (applied.current !== effective) push(effective);

    const timer = setInterval(() => {
      if (Date.now() < settleUntil.current) return;
      const actual = player.isMuted?.() ?? null;
      if (actual === null) return;
      if (actual === effective) {
        applied.current = actual;
        return;
      }

      // The player disagrees, and this board did not do it. Either you used
      // the player's own control, or the embed reset itself.
      // The stream's mute is the board's own switch at the Windows level, so
      // nothing else can change it: a disagreement there is only ever a helper
      // that restarted, and the answer is to say it again.
      const quietOnPurpose = hushed || silenced || kind === "stream";
      if (!quietOnPurpose && actual && !muted) {
        // Muted from inside the player. Always your doing; the bar follows.
        setMuted(true);
        rememberMuted(entry.key, true, lane);
        applied.current = true;
        return;
      }
      const byHand = mountRef.current?.contains(document.activeElement) ?? false;
      const justRestarted = Date.now() - restartedAt.current < 10_000;
      if (!quietOnPurpose && !actual && muted && byHand && !justRestarted) {
        // Unmuted from inside the player, and not by a reload.
        setMuted(false);
        rememberMuted(entry.key, false, lane);
        applied.current = false;
        return;
      }
      push(effective);
    }, 1000);
    return () => clearInterval(timer);
  }, [ready, entry, kind, lane, effective, muted, hushed, silenced]);

  useEffect(() => {
    registerHush(lane, () => {
      const player = playerRef.current;
      if (!player) return () => {};

      // A live broadcast is muted rather than paused, and through the same
      // enforced mute as everything else, so what you had muted by hand is
      // still muted afterwards whatever the embed did in between.
      //
      // The stream window is a real window on top of the board, so it steps
      // aside as well: the takeover would be drawn underneath the match.
      if (kind === "stream" || kind === "twitch") {
        setHushed(true);
        if (kind === "stream") player.setHidden?.(true);
        return () => {
          if (kind === "stream") player.setHidden?.(false);
          setHushed(false);
        };
      }

      if (state !== "playing") return () => {};
      player.pause();
      return () => player.play();
    });
    return () => registerHush(lane, null);
  }, [lane, kind, state]);

  const toggle = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (state === "playing") player.pause();
    else player.play();
  }, [state]);

  const toggleMute = useCallback(() => {
    if (!entry) return;
    // Silent only because the other player has the big screen: pressing the
    // speaker means "let me hear this one", so it takes the sound instead.
    if (silenced && !muted) {
      takeFocus(lane);
      return;
    }
    const next = !muted;
    setMuted(next);
    rememberMuted(entry.key, next, lane);
  }, [entry, silenced, muted, lane]);

  /**
   * Dragging the corner player.
   *
   * ON THE BAR, NOT THE PICTURE, and that is forced rather than chosen: the
   * video is an iframe belonging to YouTube or Twitch, and it swallows every
   * pointer event before this document sees one. The bar underneath is the only
   * part of the player this page still owns.
   *
   * Pointer capture rather than window listeners so the drag survives the
   * cursor crossing the iframe — without it, moving fast over the video drops
   * the pointer and the player sticks halfway.
   */
  /**
   * Where this corner player is drawn, and where the shared corner is.
   *
   * Worked out from the shared corner rather than measured, so a stacked player
   * moves in the same frame as the one it sits on. The two are always the same
   * size, since they share the width.
   *
   * BOTH IN THE CORNER: the video keeps the corner and the stream sits straight
   * above it — or below, if there is no room above. One player alone just uses
   * the corner, unless its parked spot is under the other player (yield_).
   */
  const layoutCorner = () => {
    const width = corner.width ?? defaultPipWidth();
    const height = pipHeightFor(width);
    const anchor = corner.point
      ? clampPip(corner.point, width, height)
      : defaultCornerPoint(width, height);
    const stacked =
      lane === "stream" && mode === "mini" && otherEntry !== null && tab !== homeFor(otherEntry);
    if (stacked) {
      const above = anchor.top - height - 10;
      return {
        anchor,
        stacked,
        pos: { left: anchor.left, top: above >= 8 ? above : anchor.top + height + 10 },
      };
    }
    return { anchor, stacked, pos: corner.point && !yield_ ? anchor : null };
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // Docked and filled are measured against a panel every ResizeObserver tick,
    // so a dragged position there would be overwritten within the frame.
    if (placed) return;
    if ((event.target as HTMLElement).closest("button, .watchgrip")) return;
    const dock = dockRef.current;
    if (!dock) return;

    const rect = dock.getBoundingClientRect();
    const { anchor, stacked } = layoutCorner();
    // A stacked player drags the pair: what moves is the corner under it.
    const ox = stacked ? anchor.left - rect.left : 0;
    const oy = stacked ? anchor.top - rect.top : 0;
    drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, ox, oy };
    // Seeded from where it is drawn, so the first pixel of movement does not
    // jump the player from its CSS corner to the cursor.
    const start: Corner = {
      point: clampPip({ left: rect.left + ox, top: rect.top + oy }, rect.width, rect.height),
      width: corner.width,
    };
    pending.current = start;
    previewCorner(start);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    const dock = dockRef.current;
    if (!held || !dock) return;
    const rect = dock.getBoundingClientRect();
    const next: Corner = {
      point: clampPip(
        { left: event.clientX - held.dx + held.ox, top: event.clientY - held.dy + held.oy },
        rect.width,
        rect.height,
      ),
      width: corner.width,
    };
    pending.current = next;
    previewCorner(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (pending.current) commitCorner(pending.current);
    pending.current = null;
  };

  /**
   * Resizing the corner player, from the grip at the end of its bar.
   *
   * On the bar for the same reason dragging is: the picture belongs to an
   * iframe or to the stream's own window, and neither lets the page see the
   * pointer. Resizing pins the top-left corner and moves the bottom-right one,
   * so a player still in its CSS corner is parked where it stands first.
   */
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (placed) return;
    const dock = dockRef.current;
    if (!dock) return;
    const rect = dock.getBoundingClientRect();
    const { anchor, stacked } = layoutCorner();
    const origin = stacked
      ? anchor
      : clampPip({ left: rect.left, top: rect.top }, rect.width, rect.height);
    resize.current = { x: event.clientX, width: rect.width, origin };
    const start: Corner = { point: origin, width: Math.round(rect.width) };
    pending.current = start;
    previewCorner(start);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = resize.current;
    if (!held) return;
    const wanted = held.width + event.clientX - held.x;
    const next: Corner = {
      point: held.origin,
      width: Math.round(Math.min(maxPipWidth(held.origin), Math.max(PIP_MIN_WIDTH, wanted))),
    };
    pending.current = next;
    previewCorner(next);
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resize.current) return;
    resize.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (pending.current) commitCorner(pending.current);
    pending.current = null;
  };

  if (!entry) return null;
  // One frame before localStorage has been read. Rendering mini here would flick
  // a corner player into view on every load of the Watch tab.
  if (tab === null) return null;

  const placed = mode !== "mini" && box?.mode === mode;
  // Both players in the corner, and this one never dragged: the stream sits
  // above the video instead of on it. A native window cannot be underneath a
  // DOM element, so an overlap here would hide half of one of them.
  const layout = layoutCorner();
  const miniStyle: React.CSSProperties = {};
  if (corner.width) miniStyle.width = corner.width;
  if (layout.pos) {
    // right/bottom cleared explicitly: .is-mini sets both, and left alone they
    // would fight the position and pin the player to the CSS corner.
    Object.assign(miniStyle, {
      left: layout.pos.left,
      top: layout.pos.top,
      right: "auto",
      bottom: "auto",
    });
  }
  const quiet = muted || silenced;
  const label = [entry.title, entry.channel].filter(Boolean).join(" · ");
  const site =
    entry.kind === "youtube" ? "YouTube" : entry.kind === "stream" ? entry.channel || "the site" : "Twitch";

  return (
    <div
      ref={dockRef}
      className={`watchdock is-${placed ? mode : "mini"}`}
      data-lane={lane}
      style={
        placed && box
          ? { left: box.left, top: box.top, width: box.width, height: box.height }
          : miniStyle
      }
    >
      {/* Under the picture, where the mouse already is and where every player
          anyone has ever used puts it. */}
      <div className="watchmount" ref={mountRef} />

      <div
        className={`watchbar${placed ? "" : " is-grab"}`}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          type="button"
          className="watchbtn"
          onClick={toggle}
          disabled={!ready}
          aria-label={state === "playing" ? "Pause" : "Play"}
          title={state === "playing" ? "Pause" : "Play"}
        >
          {state === "playing" ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          type="button"
          className={`watchbtn${silenced && !muted ? " is-silenced" : ""}`}
          onClick={toggleMute}
          disabled={!ready}
          aria-pressed={muted}
          aria-label={muted ? "Unmute" : silenced ? "Hear this one instead" : "Mute"}
          title={
            muted
              ? "Unmute"
              : silenced
                ? "Quiet while the other player is on the big screen. Press to hear this one."
                : "Mute"
          }
        >
          {quiet ? <MutedIcon /> : <SoundIcon />}
        </button>

        {/* The machine's own output and microphone used to sit here, straight
            after this video's mute. They live in the left stack's Quick row now:
            the argument for putting them here was real — "why can I not hear
            this" and "where is it coming out" belong within one reach — but the
            bar goes away with the player, and the sound has to be movable at
            three in the afternoon with nothing playing. Two sets of buttons for
            one mixer is worse than either. */}

        <button
          type="button"
          className="watchbtn is-wide"
          onClick={() => playerRef.current?.reload()}
          disabled={!ready}
          aria-label="Reload"
          title="Reload — gets a dropped stream back"
        >
          <ReloadIcon />
        </button>

        {/* Doubles as the way back: in the corner player the caption is the
            biggest thing to aim at, and what you want when you see it is the
            panel it came from. */}
        <button
          type="button"
          className="watchlabel"
          onClick={() => selectTab("center", home)}
          title={label}
        >
          {label}
        </button>

        <button
          type="button"
          className="watchbtn is-wide"
          onClick={() => {
            selectTab("center", home);
            setExpanded(!expanded, lane);
          }}
          aria-pressed={expanded}
          aria-label={expanded ? "Shrink to the stage" : "Fill the panel"}
          title={expanded ? "Shrink to the stage" : "Fill the panel"}
        >
          {expanded ? <ShrinkIcon /> : <ExpandIcon />}
        </button>

        {entry.kind === "stream" ? (
          <>
            {/* A kiosk window has no back button of its own, and no address
                bar to get home with. These are the two things it cannot do. */}
            <button
              type="button"
              className="watchbtn"
              onClick={() => playerRef.current?.back?.()}
              disabled={!ready}
              aria-label="Back"
              title="Back"
            >
              <BackIcon />
            </button>
            <button
              type="button"
              className="watchbtn"
              onClick={() => playerRef.current?.home?.()}
              disabled={!ready}
              aria-label={`Back to where ${site} opened`}
              title={`Back to where ${site} opened`}
            >
              <HomeIcon />
            </button>
          </>
        ) : (
          <a
            className="watchbtn"
            href={entry.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open on ${site}`}
            title={`Open on ${site}`}
          >
            <OpenIcon />
          </a>
        )}

        <button
          type="button"
          className="watchbtn"
          onClick={() => {
            setExpanded(false, lane);
            clearWatching(lane);
          }}
          aria-label="Close the player"
          title="Close the player"
        >
          <CloseIcon />
        </button>

        {!placed && (
          <div
            className="watchgrip"
            onPointerDown={startResize}
            onPointerMove={onResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            title="Drag to resize"
            aria-hidden
          />
        )}
      </div>
      {/* A stream says why on its own placeholder, and its link would open in
          the board's own browser — which has none of the streaming logins. */}
      {failed && entry.kind !== "stream" && (
        <p className="watchfail">
          That player would not load.{" "}
          <a href={entry.href} target="_blank" rel="noreferrer">
            Open it on {site} →
          </a>
        </p>
      )}
    </div>
  );
}

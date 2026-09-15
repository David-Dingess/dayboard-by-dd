"use client";

/**
 * One button, held by the player, pressed by whatever takes the screen.
 *
 * The eye break blacks the board out for twenty-five seconds. A YouTube video
 * carrying on behind that is a video you miss twenty-five seconds of, and a
 * Twitch stream is twenty-five seconds of a stranger talking into a dark room —
 * so the break quiets what is playing and then puts it back exactly as it found
 * it.
 *
 * THE RESTORE IS THE RETURN VALUE, and that is the whole design. `hushPlayers()`
 * hands back the function that undoes it, so the caller cannot hold a boolean
 * that gets out of step with reality, and React's own effect cleanup is a
 * perfectly good place to put it — unmount, skip, snooze and finish all end in
 * the same line. A state flag here would eventually leave a stream muted with no
 * way to notice.
 *
 * PAUSE FOR A VIDEO, MUTE FOR A STREAM, because they are different promises. A
 * video waits; a live broadcast does not, and pausing it would either desync it
 * or silently drop the viewer twenty-five seconds behind. It is also why a
 * player already paused, or already muted by hand, is left alone entirely: the
 * break's job is to be undoable, not to be tidy.
 *
 * WatchPlayer registers; anything that takes the screen calls. ONE SLOT PER
 * LANE: the video player and the Sports stream window can both be on, and a
 * break has to quiet both of them and put both back.
 */

/** Quiet whatever is playing, and hand back the function that undoes it. */
export type Hush = () => () => void;

const registered = new Map<string, Hush>();

export function registerHush(lane: string, hush: Hush | null): void {
  if (hush) registered.set(lane, hush);
  else registered.delete(lane);
}

/**
 * Quiet every player there is. Always returns a restore function, so the caller
 * never has to care whether anything was playing at all.
 */
export function hushPlayers(): () => void {
  const restores: (() => void)[] = [];
  for (const hush of registered.values()) {
    try {
      restores.push(hush());
    } catch {
      // A player torn down between the click and here. Nothing to put back.
    }
  }
  return () => {
    for (const restore of restores.reverse()) {
      try {
        restore();
      } catch {
        // Same again, twenty-five seconds later: the thing we paused is gone.
      }
    }
  };
}

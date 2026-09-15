import { action, type KeyAction, type KeyDownEvent } from "@elgato/streamdeck";
import { LiveKey, report } from "./live.js";
import { current, send, type DeckState } from "../board.js";
import { alertsKey, asKeyImage, audioKey, expandKey, muteKey, resetKey, waterKey } from "../art.js";
import type { JsonValue } from "@elgato/utils";

/**
 * The keys that are not a list: the video's size, the water, the mixer and the
 * window pin.
 *
 * Four of the five draw live state, and the one that cannot says so. Which half
 * a key is in comes down to where the truth lives — the mixer and the pin are
 * facts the agent will tell anyone who asks, the water is on disk, and whether
 * the player is filling the panel is in a browser that talks to nobody.
 */

/* ----------------------------------------------------------------- video -- */

/**
 * Fill the centre panel, or put the video back in its corner.
 *
 * WRITE-ONLY, LIKE THE TAB KEYS. dayboard.watch.expanded never leaves the
 * browser, so this key cannot know which way round it currently is and does not
 * pretend to: it alternates its own idea and sends that. Press it twice and you
 * are back where you started either way, which is the behaviour a toggle owes
 * you even when it is guessing.
 */
@action({ UUID: "com.dayboard.deck.expand" })
export class ExpandKey extends LiveKey {
  #on = false;

  protected face(): string {
    return expandKey(this.#on);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    this.#on = !this.#on;
    void (ev.action as KeyAction).setImage(expandKey(this.#on));
    await report(ev.action as KeyAction, await send({ cmd: "expand", on: this.#on }));
  }
}

/* ----------------------------------------------------------------- water -- */

interface WaterSettings {
  /** Negative is the undo. 8, 16 and 40 are the pours the bottle offers. */
  ounces?: number;
  [key: string]: JsonValue | undefined;
}

@action({ UUID: "com.dayboard.deck.water" })
export class WaterKey extends LiveKey<WaterSettings> {
  protected face(state: DeckState | null, settings: WaterSettings): string {
    const ounces = Number.isInteger(settings.ounces) ? settings.ounces! : 8;
    const water = state?.water;
    return waterKey(ounces, water?.ounces ?? 0, water?.goalOz ?? 0);
  }

  override async onKeyDown(ev: KeyDownEvent<WaterSettings>): Promise<void> {
    const settings = this.settingsOf(ev.action as KeyAction<WaterSettings>);
    const ounces = Number.isInteger(settings.ounces) ? settings.ounces! : 8;
    await report(ev.action as KeyAction, await send({ cmd: "water", ounces }));
  }
}

/* ----------------------------------------------------------------- audio -- */

/**
 * Where the sound comes out. One key, and its picture is the answer.
 *
 * This is the one that replaced an older button: the old button sent a fixed command
 * and could not show which room was live, so it was a coin flip whether pressing
 * it did what you wanted. The agent resolves "toggle" against Voicemeeter's
 * actual mute states and answers with the result, so the icon is never a guess.
 */
@action({ UUID: "com.dayboard.deck.audio" })
export class AudioKey extends LiveKey {
  protected face(state: DeckState | null): string {
    return audioKey(state?.audio?.live ?? "none", !state?.audio?.running);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    // Sent whatever the last poll thought. A key that refuses locally is a key
    // that stays dead for three seconds after the mixer comes back, and the
    // route already answers 502 with an alert if the agent really is absent.
    await report(ev.action as KeyAction, await send({ cmd: "audio", output: "toggle" }));
  }
}

/**
 * Silence, and the room it silences.
 *
 * Its own key rather than a long press on the one above, because muting is the
 * thing you reach for in a hurry — the doorbell, the phone — and a control you
 * have to hold down for is the wrong shape for that.
 */
@action({ UUID: "com.dayboard.deck.mute" })
export class MuteKey extends LiveKey {
  protected face(state: DeckState | null): string {
    return muteKey(state?.audio?.live === "none", !state?.audio?.running);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    // The agent takes on/off rather than a toggle here and remembers which room
    // was live before the mute, so this asks for the opposite of what it can see.
    const mute = current()?.audio?.live === "none" ? "off" : "on";
    await report(ev.action as KeyAction, await send({ cmd: "audio", mute }));
  }
}

/* ---------------------------------------------------------------- alerts -- */

/**
 * Press the banner's "Turn on alerts" button without walking over to it.
 *
 * WHY IT COMES BACK EVERY LOAD, since that is the actual complaint: the
 * notification grant is per-profile and permanent, but an AudioContext starts
 * suspended in every new page life — so `audioArmed()` is false again after each
 * refresh and the banner is telling the truth. Resuming it is the fix, and the
 * board's Chrome allows that without a gesture.
 *
 * No state on the key. Whether the chime is armed is not something the board
 * publishes, and the banner is a better readout than a 72px square anyway.
 */
@action({ UUID: "com.dayboard.deck.alerts" })
export class AlertsKey extends LiveKey {
  protected face(): string {
    return alertsKey();
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await report(ev.action as KeyAction, await send({ cmd: "alerts" }));
  }
}


/* ----------------------------------------------------------------- reset -- */

/**
 * The reset button beside the board's Agent light, from the deck.
 *
 * The route runs the same resetBoard() the button does, and tells the page to
 * wait out the restart and reload — so this works even when the page is the
 * thing that is stuck, as long as the server still answers. The key says
 * "Resetting" until the board has had time to come back.
 */
@action({ UUID: "com.dayboard.deck.reset" })
export class ResetKey extends LiveKey {
  #until = 0;

  protected face(): string {
    return resetKey(Date.now() < this.#until);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (Date.now() < this.#until) return;
    this.#until = Date.now() + 15_000;
    void (ev.action as KeyAction).setImage(asKeyImage(resetKey(true)));
    const ok = await send({ cmd: "reset" });
    if (!ok) this.#until = 0;
    await report(ev.action as KeyAction, ok);
  }
}

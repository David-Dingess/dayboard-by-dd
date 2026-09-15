import streamDeck, {
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { current, watch, type DeckState } from "../board.js";
import { asKeyImage, offlineKey } from "../art.js";

/**
 * A key that draws itself from the board's state and redraws when it changes.
 *
 * Every action in this plugin is one of these, which is why none of them own a
 * timer: they subscribe on willAppear and unsubscribe on willDisappear, and
 * board.ts runs exactly one poll behind however many are on screen. A key that
 * is not on screen costs nothing at all — flip to another profile and the plugin
 * stops asking.
 *
 * SETTINGS ARE HELD PER KEY INSTANCE rather than re-read on every draw, because
 * getSettings is a round trip to the Stream Deck app and this redraws every
 * three seconds. They arrive with willAppear and again whenever the property
 * inspector changes them.
 */
export abstract class LiveKey<T extends JsonObject = JsonObject> extends SingletonAction<T> {
  readonly #stop = new Map<string, () => void>();
  readonly #settings = new Map<string, T>();

  /** The SVG this key should be showing. Null leaves whatever is there alone. */
  protected abstract face(state: DeckState | null, settings: T): string | null;

  override onWillAppear(ev: WillAppearEvent<T>): void {
    if (!ev.action.isKey()) return;
    const key = ev.action;
    this.#settings.set(key.id, ev.payload.settings);

    this.#stop.get(key.id)?.();
    this.#stop.set(
      key.id,
      watch((state) => this.paint(key, state)),
    );
  }

  override onWillDisappear(ev: WillDisappearEvent<T>): void {
    this.#stop.get(ev.action.id)?.();
    this.#stop.delete(ev.action.id);
    this.#settings.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): void {
    if (!ev.action.isKey()) return;
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.paint(ev.action, undefined);
  }

  /** The settings a subclass's onKeyDown needs, without a round trip. */
  protected settingsOf(key: KeyAction<T>): T {
    return this.#settings.get(key.id) ?? ({} as T);
  }

  private paint(key: KeyAction<T>, state: DeckState | null | undefined): void {
    const settings = this.settingsOf(key);
    // undefined means "a settings change, not a poll" — redraw against the last
    // snapshot the poller took rather than blanking the key until the next one.
    const snapshot = state === undefined ? current() : state;

    const image = snapshot === null ? offlineKey() : this.face(snapshot, settings);
    if (image !== null) void key.setImage(asKeyImage(image));
    // Always blank. Every face in art.ts draws its own words at a size and
    // position chosen for that key; a Stream Deck title on top would be a second,
    // staler copy of the same text in the app's font.
    void key.setTitle("");
  }
}

/** A press that did not land. The deck's own way of saying so. */
export async function report(key: KeyAction<JsonObject>, ok: boolean): Promise<void> {
  if (ok) return;
  streamDeck.logger.warn(`key ${key.manifestId} refused`);
  await key.showAlert();
}

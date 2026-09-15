import { action, type KeyAction, type KeyDownEvent } from "@elgato/streamdeck";
import { LiveKey, report } from "./live.js";
import { send, type DeckState } from "../board.js";
import { tabKey } from "../art.js";
import type { JsonValue } from "@elgato/utils";

/**
 * One panel, one tab.
 *
 * The label is the key's own, not the board's: a tab called "Computer" on the
 * board can be "PC" on a 72-pixel key, and a deck is allowed to abbreviate what
 * a second monitor spells out. The id is what must
 * match, and /api/deck refuses one that does not.
 *
 * IT DOES NOT LIGHT UP. Which tab a panel is showing lives in the board's
 * localStorage and is never sent anywhere, so the plugin genuinely cannot know
 * — and a key that guesses would be lit on the wrong one half the time, which is
 * worse than a key that never claims. Pressing it is idempotent anyway: the tab
 * you asked for is the tab you get.
 */
interface TabSettings {
  side?: "center" | "right";
  id?: string;
  label?: string;
  /** Which mark to draw above the word — a key in GLYPHS. Omit for text only. */
  icon?: string;
  [key: string]: JsonValue | undefined;
}

@action({ UUID: "com.dayboard.deck.tab" })
export class TabKey extends LiveKey<TabSettings> {
  protected face(_state: DeckState | null, settings: TabSettings): string {
    return tabKey(settings.label ?? settings.id ?? "tab", false, settings.icon);
  }

  override async onKeyDown(ev: KeyDownEvent<TabSettings>): Promise<void> {
    const { side, id } = this.settingsOf(ev.action as KeyAction<TabSettings>);
    if (!side || !id) return void ev.action.showAlert();
    await report(ev.action as KeyAction, await send({ cmd: "tab", side, id }));
  }
}

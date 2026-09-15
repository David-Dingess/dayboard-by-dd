import { action, type KeyAction, type KeyDownEvent } from "@elgato/streamdeck";
import { LiveKey, report } from "./live.js";
import { BASE, current, picture, send, type DeckState } from "../board.js";
import { emptyKey, streamKey, teamKey, videoKey } from "../art.js";
import type { JsonValue } from "@elgato/utils";

/**
 * The two list pages: the unwatched videos, and who is live.
 *
 * A KEY HOLDS A POSITION, NOT A VIDEO. Every key on the NL page is the same
 * action with a different `slot`, and slot 3 draws whatever is third in the list
 * right now. That is the whole trick behind "list the videos, push to play" on
 * hardware with fixed buttons: the profile never changes, and the page is a
 * window onto a list that does.
 *
 * It also means the pages match the panel exactly, because the list they index
 * into is the same one the board filters — cleared videos already gone, streams
 * already sorted by audience. Press the third key and you get the third tile.
 *
 * A SLOT PAST THE END IS BLANK, not an error and not the last item repeated.
 * Fourteen keys and two unwatched videos is the normal state of a Tuesday.
 */
interface SlotSettings {
  slot?: number;
  [key: string]: JsonValue | undefined;
}

const slotOf = (settings: SlotSettings): number =>
  Number.isInteger(settings.slot) && settings.slot! >= 0 ? settings.slot! : 0;

@action({ UUID: "com.dayboard.deck.video" })
export class VideoKey extends LiveKey<SlotSettings> {
  protected face(state: DeckState | null, settings: SlotSettings): string {
    const video = state?.videos[slotOf(settings)];
    if (!video) return emptyKey("");
    return videoKey(video, picture(video.thumbnail));
  }

  override async onKeyDown(ev: KeyDownEvent<SlotSettings>): Promise<void> {
    const video = this.stateVideo(ev);
    if (!video) return void ev.action.showAlert();
    await report(
      ev.action as KeyAction,
      await send({
        cmd: "play",
        kind: "youtube",
        key: video.key,
        title: video.title,
        channel: video.channel,
        href: video.href,
      }),
    );
  }

  private stateVideo(ev: KeyDownEvent<SlotSettings>) {
    return current()?.videos[slotOf(this.settingsOf(ev.action as KeyAction<SlotSettings>))];
  }
}

@action({ UUID: "com.dayboard.deck.stream" })
export class StreamKey extends LiveKey<SlotSettings> {
  protected face(state: DeckState | null, settings: SlotSettings): string {
    const stream = state?.streams[slotOf(settings)];
    if (!stream) return emptyKey("");
    return streamKey(stream, picture(stream.avatar));
  }

  override async onKeyDown(ev: KeyDownEvent<SlotSettings>): Promise<void> {
    const stream =
      current()?.streams[slotOf(this.settingsOf(ev.action as KeyAction<SlotSettings>))];
    if (!stream) return void ev.action.showAlert();
    await report(
      ev.action as KeyAction,
      await send({
        cmd: "play",
        kind: "twitch",
        key: stream.key,
        // The stream's own title, which is what the board's tile shows too.
        title: stream.title,
        channel: stream.channel,
        href: stream.href,
      }),
    );
  }
}

/**
 * The Sports folder: one key per team, opening that team's streaming site in
 * the Sports tab's stream window — exactly what clicking its tile does.
 *
 * The same slot trick as the two pages above, over the board's own team tiles
 * (lib/sports-tiles.ts), so the fifth club added to upstreams.json turns up as
 * the fifth key. A team with no known stream draws dimmed and refuses the press.
 */
@action({ UUID: "com.dayboard.deck.team" })
export class TeamKey extends LiveKey<SlotSettings> {
  protected face(state: DeckState | null, settings: SlotSettings): string {
    const team = state?.teams?.[slotOf(settings)];
    if (!team) return emptyKey("");
    // A path on the board; the key's renderer cannot fetch, so picture() inlines it.
    const logo = team.logo ? picture(team.logo.startsWith("/") ? `${BASE}${team.logo}` : team.logo) : null;
    return teamKey({ ...team, playable: Boolean(team.url) }, logo);
  }

  override async onKeyDown(ev: KeyDownEvent<SlotSettings>): Promise<void> {
    const team = current()?.teams?.[slotOf(this.settingsOf(ev.action as KeyAction<SlotSettings>))];
    if (!team?.url || !team.service) return void ev.action.showAlert();
    await report(
      ev.action as KeyAction,
      await send({
        cmd: "play",
        kind: "stream",
        // The site is the key, as it is for a tile: that is how the board tells
        // which team is already on.
        key: team.url,
        title: team.title,
        channel: team.service,
        href: team.url,
      }),
    );
  }
}

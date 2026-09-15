import streamDeck from "@elgato/streamdeck";
import { TabKey } from "./keys/tab.js";
import { StreamKey, TeamKey, VideoKey } from "./keys/watch.js";
import { AlertsKey, AudioKey, ExpandKey, MuteKey, ResetKey, WaterKey } from "./keys/controls.js";

/**
 * Dayboard on a Stream Deck.
 *
 * Ten actions, one poller, one origin. The plugin holds no state of its own
 * worth speaking of — every key draws from http://127.0.0.1:6767/api/deck/state
 * and every press POSTs to /api/deck, which is why there is nothing here to keep
 * in step with the board and nothing to go stale when it is rebuilt.
 *
 * Set DAYBOARD_URL if the board ever moves off 6767. Everything else the deck
 * needs to know is in the answer.
 */

// "info" and above. Debug is a firehose of every event the app sends.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new TabKey());
streamDeck.actions.registerAction(new VideoKey());
streamDeck.actions.registerAction(new StreamKey());
streamDeck.actions.registerAction(new ExpandKey());
streamDeck.actions.registerAction(new WaterKey());
streamDeck.actions.registerAction(new AudioKey());
streamDeck.actions.registerAction(new MuteKey());
streamDeck.actions.registerAction(new AlertsKey());
streamDeck.actions.registerAction(new TeamKey());
streamDeck.actions.registerAction(new ResetKey());

streamDeck.connect();

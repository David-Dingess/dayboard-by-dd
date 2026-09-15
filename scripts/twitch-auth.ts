import { loadSettings } from "../src/lib/settings";
import { startTwitchAuth, TWITCH_REDIRECT } from "../src/lib/twitch-auth";
import { notifyBoard } from "./notify-board";

/**
 * The one-time Twitch authorization, from a terminal. The setup guide's
 * Authorize button does the same thing from the board; both run
 * lib/twitch-auth.ts, which writes the refresh token and user id into
 * data/settings.json.
 *
 *   npm run twitch:auth
 *
 * The client id and secret come from settings (or, for a first run before
 * anything is saved, TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET in the env).
 */

const { clientId, clientSecret } = loadSettings().twitch;

if (!clientId || !clientSecret) {
  console.error(
    "Save a Twitch client id and secret first (Settings -> Twitch, or npm run settings -- set twitch.clientId ...).\n" +
      "Register an app at https://dev.twitch.tv/console/apps with OAuth Redirect URL\n" +
      `  ${TWITCH_REDIRECT}\n` +
      "and client type Confidential.",
  );
  process.exit(1);
}

startTwitchAuth(clientId, clientSecret, (grant) => {
  console.log(`\nAuthorized as ${grant.login} (user id ${grant.userId}). Saved to data/settings.json.`);
  console.log("Check it: npm run check:widgets -- twitch\n");
  notifyBoard();
  setTimeout(() => process.exit(0), 300);
})
  .then(({ url }) => {
    console.log("\nOpen this, and click Authorize:\n");
    console.log(url);
    console.log(`\nWaiting on ${TWITCH_REDIRECT} …`);
  })
  .catch((err) => {
    console.error(`twitch:auth: ${(err as Error).message}`);
    process.exit(1);
  });

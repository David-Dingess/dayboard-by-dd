import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { loadSettings, saveSettings } from "./settings";

/**
 * The one-time Twitch authorization.
 *
 * Twitch's follow list needs a USER token, so somebody has to click Authorize in
 * a browser once. A throwaway HTTP server on loopback takes the redirect,
 * exchanges the code, asks Twitch who you are, writes the refresh token and
 * user id into data/settings.json, and stops existing.
 *
 * Shared by the guide's Authorize button (a Server Action starts it inside the
 * Next process) and `npm run twitch:auth` (the same thing from a terminal).
 * Both pass the client id and secret in rather than reading the file, so the
 * CLI can be run before anything has been saved.
 */

export const TWITCH_AUTH_PORT = 7345;
export const TWITCH_REDIRECT = `http://localhost:${TWITCH_AUTH_PORT}/callback`;
const SCOPE = "user:read:follows";

export interface TwitchGrant {
  login: string;
  userId: string;
  refreshToken: string;
}

function page(body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Dayboard</title><body style="font:21px/1.45 system-ui;background:#111;color:#ececec;padding:60px">${body}</body>`;
}

async function exchange(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: TWITCH_REDIRECT,
    }),
  });
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; message?: string };
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new Error(body.message ?? `Twitch said ${res.status}`);
  }
  return { refreshToken: body.refresh_token, accessToken: body.access_token };
}

async function whoAmI(clientId: string, accessToken: string): Promise<{ id: string; login: string }> {
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: { "client-id": clientId, authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json()) as { data?: { id?: string; login?: string }[] };
  const me = body.data?.[0];
  if (!res.ok || !me?.id) throw new Error(`Twitch would not say who you are (${res.status})`);
  return { id: me.id, login: me.login ?? "" };
}

let running: { server: Server; state: string; url: string } | null = null;

/**
 * Start listening and hand back the URL to open. Idempotent: a second call
 * while the first is still waiting returns the same URL. The listener gives up
 * after ten minutes so an abandoned attempt does not hold the port forever.
 *
 * `onGrant` runs after the settings file has been written.
 */
export function startTwitchAuth(
  clientId: string,
  clientSecret: string,
  onGrant?: (grant: TwitchGrant) => void,
): Promise<{ url: string }> {
  if (running) return Promise.resolve({ url: running.url });
  if (!clientId || !clientSecret) return Promise.reject(new Error("Client ID and secret first."));

  // Not optional. Without it, anything that can reach loopback can feed us a code.
  const state = randomBytes(16).toString("hex");
  const url =
    "https://id.twitch.tv/oauth2/authorize?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: TWITCH_REDIRECT,
      response_type: "code",
      scope: SCOPE,
      state,
      // Always show the consent screen: silently reusing an old grant is how
      // you re-mint a token for the wrong account.
      force_verify: "true",
    });

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://localhost:${TWITCH_AUTH_PORT}`);
      if (reqUrl.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const finish = (status: number, html: string) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(page(html));
        setTimeout(() => stop(), 250);
      };
      if (reqUrl.searchParams.get("state") !== state) {
        finish(400, "<h1>State mismatch</h1><p>Nothing was saved. Press Authorize again.</p>");
        return;
      }
      const error = reqUrl.searchParams.get("error_description") ?? reqUrl.searchParams.get("error");
      if (error) {
        finish(400, `<h1>Denied</h1><p>${error}</p>`);
        return;
      }
      const code = reqUrl.searchParams.get("code");
      if (!code) {
        finish(400, "<h1>No code</h1>");
        return;
      }
      try {
        const { refreshToken, accessToken } = await exchange(clientId, clientSecret, code);
        const me = await whoAmI(clientId, accessToken);
        const s = loadSettings();
        saveSettings({
          ...s,
          twitch: { ...s.twitch, clientId, clientSecret, refreshToken, userId: me.id },
        });
        onGrant?.({ login: me.login, userId: me.id, refreshToken });
        finish(200, `<h1>Authorized as ${me.login}</h1><p>Saved. You can close this tab and go back to the board.</p>`);
      } catch (err) {
        finish(500, `<h1>Failed</h1><p>${(err as Error).message}</p>`);
      }
    });

    const stop = () => {
      if (!running) return;
      running = null;
      server.close();
    };

    server.once("error", (err) => {
      running = null;
      reject(err);
    });
    server.listen(TWITCH_AUTH_PORT, "127.0.0.1", () => {
      running = { server, state, url };
      setTimeout(stop, 10 * 60_000).unref();
      resolve({ url });
    });
  });
}

/** Whether a grant is still being waited on — the guide polls this after opening the URL. */
export function twitchAuthPending(): boolean {
  return running !== null;
}

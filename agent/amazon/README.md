# Amazon agent

Reads your recent Amazon orders and writes `data/packages.json`, which the
board's **Packages** tab renders — what is on the way, what is out for delivery
(that one pulses), what just arrived, and return windows about to close. Built on
[amazon-orders](https://github.com/alexdlaird/amazon-orders) by
[Alex Laird](https://github.com/alexdlaird), MIT licensed — the library does the
real work of reading Amazon's order history; this agent only maps it onto the
board. Thank you, Alex.

The board never touches Amazon. This agent logs in **once**, interactively, then
a scheduled poll reuses the saved session headlessly.

**Your Amazon password is stored locally in plain text** in `data/settings.json`
(or `agent/amazon/.env`). The board's Packages section says so before you turn
it on; if that is not a trade you want, leave it off.

## Setup

1. **Deps** — the system Python is simplest:

   ```powershell
   cd agent\amazon
   py -3 -m pip install -r requirements.txt
   py -3 -m playwright install chromium
   ```

   The Playwright step fetches the browser the library drives to clear Amazon's
   JavaScript sign-in challenge — a one-time download, separate from pip.

2. **Credentials** — the board's setup guide, **Packages** section (Amazon email
   and password). `agent/amazon/.env` works as a fallback (see `.env.example`).

3. **Sign in once** — `run_login.cmd`. Amazon asks for the OTP and sometimes a
   captcha, which is why this step is by hand. On success the session is saved
   for the poll to reuse.

4. **Try the poll** — `run_poll.cmd`. It prints how many packages it wrote and
   drops `data/packages.json`; the board shows the Packages tab on its next tick.

## On a schedule

`scripts\setup.ps1` registers **dayboard-amazon** every thirty minutes while
Packages is turned on, wrapped in `conhost.exe --headless` so no console window
appears. When a poll prints `no valid session` and exits 3, the login has
expired — run `run_login.cmd` again. That is the only recurring manual step.

## What it reads

Per shipment from the order-history card (no extra requests): Amazon's status
line, the second line ("left in the mail room"), each item's title, link and
image, the return window, the tracker link. Then the tracker page for the rows
the tab shows (capped by `AMAZON_MAX_TRACKER_FETCHES`): tracking id, carrier and
the scan timeline. Whole Foods pickups, cancelled orders and returns are
skipped. amazon.com only.

Amazon's status prose is mapped to the board's fixed set (`ordered / shipped /
out_for_delivery / delivered / delayed / problem / unknown`) by `STATUS_RULES`
in `poll.py`. Anything unmatched still shows, in Amazon's own words. To tune it,
set `AMAZON_DEBUG_DIR=debug` (gitignored; the pages carry your address) and read
the dumped HTML.

The saved session, cookies and scratch files the library writes here are
gitignored — nothing from your Amazon account is committed.

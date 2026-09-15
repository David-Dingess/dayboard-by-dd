"""
Sign in to Amazon once, interactively, and leave a saved session behind.

amazon-orders persists the authenticated session (cookies) after a successful
login, so the scheduled poll can reuse it without a password prompt. This is the
one step that CANNOT be headless: Amazon will ask for the OTP / 2SV code, and
sometimes a captcha, and those need a person at the keyboard. Run it by hand once
(and again whenever the session expires — the poll will tell you when).

    python login.py

Everything else — the periodic scan — is poll.py.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from _settings import section as settings_section, get as setting  # noqa: E402


def main() -> int:
    if load_dotenv is not None:
        load_dotenv(HERE / ".env")

    conf = settings_section("amazon")
    e = dict(os.environ)
    username = setting(conf, "username", "AMAZON_USERNAME", None, e)
    password = setting(conf, "password", "AMAZON_PASSWORD", None, e)
    if not username or not password:
        print("amazon: no Amazon email and password — Settings -> Packages on the board (or agent/amazon/.env)", file=sys.stderr)
        return 2

    try:
        from browser_auth import configured_session
        # A session wired to clear Amazon's JS challenge with the [browser] extra.
        session = configured_session(username, password)
    except ImportError:
        print("amazon: pip install -r requirements.txt first", file=sys.stderr)
        return 2

    if getattr(session, "is_authenticated", False):
        print("amazon: already have a valid session — nothing to do.")
        return 0

    # Interactive: this is where the OTP / captcha prompts happen on stdin.
    session.login()

    if getattr(session, "is_authenticated", False):
        print("amazon: signed in. The saved session will be reused by poll.py.")
        return 0
    print("amazon: login did not complete.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

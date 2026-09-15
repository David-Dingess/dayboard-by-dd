"""
The board's settings file, for the Python agents.

data/settings.json is written by the setup guide (and `npm run settings`), and it
is where the mail and Amazon credentials live. This reads the one section an
agent wants and falls back to that agent's own `.env` for anyone who set things
up the old way. Import it from agent/<name>/poll.py as:

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from _settings import section

Nothing here validates: the board's zod schema is the authority, and a value
this cannot read is simply absent.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
SETTINGS = REPO / "data" / "settings.json"


def load() -> dict[str, Any]:
    try:
        with SETTINGS.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {}


def section(name: str) -> dict[str, Any]:
    """One top-level section, or an empty dict."""
    value = load().get(name)
    return value if isinstance(value, dict) else {}


def get(sect: dict[str, Any], key: str, env_name: str | None, default: Any = None, env: dict[str, str] | None = None) -> Any:
    """A settings value, else the legacy environment variable, else the default."""
    value = sect.get(key)
    if value not in (None, ""):
        return value
    if env_name and env is not None:
        raw = env.get(env_name)
        if raw not in (None, ""):
            return raw
    return default

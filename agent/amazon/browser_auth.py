"""
Build an AmazonSession that can clear Amazon's JavaScript sign-in challenge.

Out of the box amazon-orders ends its auth chain with two "blocker" forms —
AcicAuthBlocker and JSAuthBlocker — whose only job is to raise
"install the [browser] extra" when Amazon throws a challenge they cannot solve.
The [browser] extra ships Playwright forms that DO solve them, but they are not
wired in automatically: you have to register them ahead of the blockers.

So this reads the session's own default auth-form chain and swaps each blocker
for its Playwright counterpart, keeping the order (and thus the standard
sign-in / MFA / captcha handling) intact. Reading the defaults rather than
hard-coding them means a library update that changes the chain still works. If
the [browser] extra is not installed, it falls back to a plain session — which
just reproduces the original "install [browser]" message, honestly.
"""

from __future__ import annotations

SWAP = {
    "amazonorders.forms.AcicAuthBlocker": "amazonorders.contrib.browser.playwright.PlaywrightAcicForm",
    "amazonorders.forms.JSAuthBlocker": "amazonorders.contrib.browser.playwright.PlaywrightJSAuthForm",
}


def configured_session(username: str, password: str):
    from amazonorders.session import AmazonSession

    try:
        import amazonorders.contrib.browser.playwright  # noqa: F401
    except Exception:
        # No [browser] extra — let the default chain speak for itself.
        return AmazonSession(username, password)

    from amazonorders.conf import AmazonOrdersConfig

    # A throwaway session, purely to read the default auth-form chain. Building one
    # touches no network.
    probe = AmazonSession("_", "_")
    forms = []
    for form in probe.auth_forms:
        path = f"{type(form).__module__}.{type(form).__name__}"
        forms.append(SWAP.get(path, path))

    config = AmazonOrdersConfig(data={"auth_forms_classes": forms})
    return AmazonSession(username, password, config=config)

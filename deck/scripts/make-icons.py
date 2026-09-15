"""
The static PNGs the manifest needs, and only those.

A live key draws itself as SVG through setImage (see src/art.ts), so nothing in
here is ever on the wall-facing deck. These are what the Stream Deck app shows
in its own action list and category tray, before an action has been placed —
which is why they are flat marks rather than the real key faces.

Sizes are the ones Elgato's manifest schema asks for: 20x20 for the category,
28x28 for action icons, 72x72 for the plugin, each with an @2x beside it.

    python scripts/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent / "com.dayboard.deck.sdPlugin" / "imgs"

BG = (17, 17, 17, 255)
ACCENT = (75, 192, 200, 255)
DIM = (138, 138, 138, 255)
CRIT = (208, 59, 59, 255)

# The board is three columns, one fixed and two that swap. Every mark below is
# built out of that shape so the tray reads as one plugin.
COLUMNS = "columns"


def canvas(size: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def triboard(draw: ImageDraw.ImageDraw, size: int, lit: int | None, colour=ACCENT) -> None:
    """Three bars. `lit` is which one is the accent, or None for all dim."""
    pad = max(1, round(size * 0.14))
    gap = max(1, round(size * 0.07))
    width = (size - pad * 2 - gap * 2) / 3
    for i in range(3):
        x = pad + i * (width + gap)
        draw.rounded_rectangle(
            [x, pad, x + width, size - pad],
            radius=max(1, round(size * 0.06)),
            fill=colour if lit is None or i == lit else DIM,
        )


def bars(draw: ImageDraw.ImageDraw, size: int, heights: list[float], colour=ACCENT) -> None:
    """Vertical bars of differing height — the water and level marks."""
    pad = max(1, round(size * 0.16))
    gap = max(1, round(size * 0.08))
    n = len(heights)
    width = (size - pad * 2 - gap * (n - 1)) / n
    for i, h in enumerate(heights):
        x = pad + i * (width + gap)
        top = size - pad - (size - pad * 2) * h
        draw.rounded_rectangle(
            [x, top, x + width, size - pad],
            radius=max(1, round(size * 0.06)),
            fill=colour,
        )


def ring(draw: ImageDraw.ImageDraw, size: int, colour=ACCENT) -> None:
    pad = max(1, round(size * 0.18))
    draw.ellipse([pad, pad, size - pad, size - pad],
                 outline=colour, width=max(2, round(size * 0.09)))


def arrow_up(draw: ImageDraw.ImageDraw, size: int, colour=ACCENT) -> None:
    w = max(2, round(size * 0.09))
    mid = size / 2
    draw.line([size * 0.25, size * 0.24, size * 0.75, size * 0.24], fill=colour, width=w)
    draw.line([mid, size * 0.78, mid, size * 0.38], fill=colour, width=w)
    draw.line([size * 0.32, size * 0.52, mid, size * 0.36], fill=colour, width=w)
    draw.line([size * 0.68, size * 0.52, mid, size * 0.36], fill=colour, width=w)


def triangle(draw: ImageDraw.ImageDraw, size: int, colour=ACCENT) -> None:
    draw.polygon(
        [(size * 0.34, size * 0.24), (size * 0.34, size * 0.76), (size * 0.78, size * 0.5)],
        fill=colour,
    )


def frame_mark(draw: ImageDraw.ImageDraw, size: int, colour=ACCENT) -> None:
    pad = max(1, round(size * 0.18))
    draw.rounded_rectangle(
        [pad, pad * 1.4, size - pad, size - pad * 1.4],
        radius=max(1, round(size * 0.08)),
        outline=colour,
        width=max(2, round(size * 0.08)),
    )


def speaker(draw: ImageDraw.ImageDraw, size: int, colour=ACCENT, crossed=False) -> None:
    draw.polygon(
        [
            (size * 0.22, size * 0.4), (size * 0.36, size * 0.4), (size * 0.52, size * 0.24),
            (size * 0.52, size * 0.76), (size * 0.36, size * 0.6), (size * 0.22, size * 0.6),
        ],
        fill=colour,
    )
    w = max(2, round(size * 0.08))
    if crossed:
        draw.line([size * 0.62, size * 0.36, size * 0.84, size * 0.64], fill=colour, width=w)
        draw.line([size * 0.84, size * 0.36, size * 0.62, size * 0.64], fill=colour, width=w)
    else:
        draw.arc([size * 0.5, size * 0.28, size * 0.86, size * 0.72], -60, 60,
                 fill=colour, width=w)


def bell(draw: ImageDraw.ImageDraw, size: int, colour=ACCENT) -> None:
    w = max(2, round(size * 0.09))
    draw.arc([size * 0.26, size * 0.16, size * 0.74, size * 0.72], 180, 360, fill=colour, width=w)
    draw.line([size * 0.26, size * 0.44, size * 0.26, size * 0.68], fill=colour, width=w)
    draw.line([size * 0.74, size * 0.44, size * 0.74, size * 0.68], fill=colour, width=w)
    draw.line([size * 0.18, size * 0.72, size * 0.82, size * 0.72], fill=colour, width=w)
    draw.ellipse([size * 0.44, size * 0.76, size * 0.56, size * 0.88], fill=colour)


# ---- the two folder faces ---------------------------------------------------
#
# THESE ARE NOT PLACEHOLDERS, unlike everything above. Videos and Live are
# Elgato's own "Create Folder" action, so no plugin code ever runs for them and
# setImage is never called — the profile has to carry a finished picture or the
# app draws its stock folder, which is the one thing on the deck that would not
# match. So these are baked at key size, in the palette src/art.ts uses, with the
# word already in them.

SURFACE = (28, 28, 28, 255)
LINE = (42, 42, 42, 255)
INK = (236, 236, 236, 255)
KEY = 144


def _font(size: int) -> ImageFont.FreeTypeFont:
    # Segoe UI Bold, which is what the SVG faces ask for by name. A machine
    # without it gets the default bitmap font and a slightly worse label, not a
    # crash.
    for name in ("segoeuib.ttf", "seguisb.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _key_face(glyph, label: str) -> Image.Image:
    image = Image.new("RGBA", (KEY, KEY), (17, 17, 17, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([4, 4, KEY - 4, KEY - 4], radius=12, fill=SURFACE, outline=LINE, width=2)
    glyph(draw)
    font = _font(17)
    draw.text((KEY / 2, 118), label, font=font, fill=INK, anchor="ms")
    return image


def _videos(draw: ImageDraw.ImageDraw) -> None:
    """A list, with the top row playing — the folder is a queue you pick from."""
    for i, y in enumerate((30, 54, 78)):
        draw.rounded_rectangle([34, y, 74, y + 16], radius=4,
                               fill=ACCENT if i == 0 else DIM)
        draw.rounded_rectangle([82, y + 4, 110, y + 12], radius=4,
                               fill=ACCENT if i == 0 else DIM)
    draw.polygon([(46, 34), (46, 50), (62, 42)], fill=(17, 17, 17, 255))


def _live(draw: ImageDraw.ImageDraw) -> None:
    """A red dot and two arcs: on air."""
    draw.ellipse([60, 42, 84, 66], fill=CRIT)
    for pad, w in ((18, 7), (34, 7)):
        draw.arc([72 - 12 - pad, 54 - 12 - pad, 72 + 12 + pad, 54 + 12 + pad],
                 -55, 55, fill=CRIT, width=w)
        draw.arc([72 - 12 - pad, 54 - 12 - pad, 72 + 12 + pad, 54 + 12 + pad],
                 125, 235, fill=CRIT, width=w)


def _panels(draw: ImageDraw.ImageDraw) -> None:
    """The board's three columns, the right-hand one lit: the right panel's tabs."""
    for i, x in enumerate((34, 62, 90)):
        draw.rounded_rectangle([x, 28, x + 20, 82], radius=4, fill=ACCENT if i == 2 else DIM)


FOLDERS = {
    "videos": (_videos, "Videos"),
    "live": (_live, "Live"),
    "panels": (_panels, "Right panel"),
    # The Videos list mark, not the ball: the Sports TAB key already wears the
    # ball on the top row, and the folder had to be told apart from it.
    "sports": (_videos, "Sports"),
}


def reset_mark(draw: ImageDraw.ImageDraw, size: int, colour=ACCENT) -> None:
    """A circular arrow: the board's reset button."""
    w = max(2, round(size * 0.09))
    pad = size * 0.2
    draw.arc([pad, pad, size - pad, size - pad], 30, 320, fill=colour, width=w)
    draw.line([size * 0.78, size * 0.14, size * 0.78, size * 0.36, size * 0.56, size * 0.36],
              fill=colour, width=w)


MARKS = {
    "plugin": lambda d, s: triboard(d, s, 1),
    "category": lambda d, s: triboard(d, s, 1),
    "actions/tab": lambda d, s: triboard(d, s, 2),
    "actions/video": lambda d, s: triangle(d, s),
    "actions/stream": lambda d, s: (ring(d, s, CRIT), triangle(d, s, CRIT)),
    "actions/expand": lambda d, s: frame_mark(d, s),
    "actions/water": lambda d, s: bars(d, s, [0.4, 0.7, 1.0]),
    "actions/audio": lambda d, s: speaker(d, s),
    "actions/mute": lambda d, s: speaker(d, s, DIM, crossed=True),
    "actions/alerts": lambda d, s: bell(d, s),
    "actions/team": lambda d, s: (ring(d, s), triangle(d, s)),
    "actions/reset": lambda d, s: reset_mark(d, s),
}

# Elgato's schema: the plugin icon is 72x72, action icons 28x28, the category
# 20x20 — each with a doubled variant beside it for retina panels.
SIZES = {"plugin": 72, "category": 20}
DEFAULT = 28


def main() -> None:
    for name, (glyph, label) in FOLDERS.items():
        path = ROOT / "folders" / f"{name}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        _key_face(glyph, label).save(path)
        print(f"  {path.relative_to(ROOT.parent)}  {KEY}x{KEY}")

    for name, mark in MARKS.items():
        base = SIZES.get(name, DEFAULT)
        for scale, suffix in ((1, ""), (2, "@2x")):
            size = base * scale
            image, draw = canvas(size)
            mark(draw, size)
            path = ROOT / f"{name}{suffix}.png"
            path.parent.mkdir(parents=True, exist_ok=True)
            image.save(path)
            print(f"  {path.relative_to(ROOT.parent)}  {size}x{size}")


if __name__ == "__main__":
    main()

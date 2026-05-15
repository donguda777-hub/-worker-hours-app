"""
PWA icons: bold gold \"L\" on #0f172a, neon-style glow, safe margins for rounded masks.
Writes public/icon-512.png and public/icon-192.png (downscaled from 512).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

BG = (15, 23, 42)  # #0f172a
PUBLIC = Path(__file__).resolve().parent.parent / "public"


def _font_path() -> Path | None:
    candidates = [
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
        Path(r"C:\Windows\Fonts\calibrib.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/System/Library/Fonts/Helvetica.ttc"),
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def render_icon(size: int) -> Image.Image:
    w = h = size
    base = Image.new("RGBA", (w, h), (*BG, 255))

    fp = _font_path()
    if fp is None:
        raise SystemExit("No TrueType bold font found for icon generation.")

    # ~52% of canvas height for \"L\" ? leaves ~12%+ margin for rounded icon crop
    font_size = int(round(size * 0.52))
    font = ImageFont.truetype(str(fp), font_size)
    cx, cy = w // 2, h // 2

    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.text((cx, cy), "L", font=font, fill=(255, 204, 0, 200), anchor="mm")
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(4.0, size / 48)))

    out = Image.alpha_composite(base, glow)
    d = ImageDraw.Draw(out)
    stroke_w = max(2, size // 22)
    d.text(
        (cx, cy),
        "L",
        font=font,
        fill=(255, 236, 130, 255),
        stroke_width=stroke_w,
        stroke_fill=(140, 85, 8, 255),
        anchor="mm",
    )
    # Inner highlight (slight offset, low alpha)
    d.text(
        (cx - max(1, size // 90), cy - max(1, size // 70)),
        "L",
        font=font,
        fill=(255, 252, 220, 90),
        stroke_width=0,
        anchor="mm",
    )
    d.text(
        (cx, cy),
        "L",
        font=font,
        fill=(255, 215, 40, 255),
        stroke_width=max(1, stroke_w // 2),
        stroke_fill=(90, 55, 5, 255),
        anchor="mm",
    )

    return out.convert("RGB")


def main() -> None:
    master = render_icon(512)
    master.save(PUBLIC / "icon-512.png", "PNG", optimize=True)
    small = master.resize((192, 192), Image.Resampling.LANCZOS)
    small.save(PUBLIC / "icon-192.png", "PNG", optimize=True)
    print(f"Wrote {PUBLIC / 'icon-512.png'} and {PUBLIC / 'icon-192.png'}")


if __name__ == "__main__":
    main()

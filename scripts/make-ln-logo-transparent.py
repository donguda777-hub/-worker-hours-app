"""
One-off: L&N logo -> transparent PNG (black removed, small subtitle masked).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

SRC_LOCAL = Path(__file__).resolve().parent / "ln-logo-source.png"
SRC_CURSOR = Path(
    r"C:\Users\User\.cursor\projects\c-LISP-SetCableInfo-Package\assets"
    r"\c__Users_User_AppData_Roaming_Cursor_User_workspaceStorage_b29c6295c02599f155017b2d0dae0408_images_L_N_png-19802a54-4bd6-4c5a-89b8-822f0cb32143.png"
)
OUT = Path(__file__).resolve().parent.parent / "public" / "ln-logo-transparent.png"


def main() -> None:
    src = SRC_LOCAL if SRC_LOCAL.is_file() else SRC_CURSOR
    if not src.is_file():
        raise SystemExit(f"Source not found: tried {SRC_LOCAL} and {SRC_CURSOR}")

    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            mx = max(r, g, b)
            mn = min(r, g, b)

            # Remove solid / near-black background
            if mx < 22:
                px[x, y] = (0, 0, 0, 0)
                continue
            if mx < 55:
                t = (mx - 22) / (55 - 22)
                na = int(round(a * max(0.0, min(1.0, t))))
                px[x, y] = (r, g, b, na)
                continue

            # "Live & Neutral": cream / gray script under N (low chroma, elevated mins)
            if y >= 368 and x >= 598:
                if mn > 18 and mx < 210 and (r + g + b) > 110 and (mx - mn) < 78:
                    px[x, y] = (0, 0, 0, 0)
                    continue

    # Second pass: flat bright script remnants (avoid left side = L body)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            chroma = max(r, g, b) - min(r, g, b)
            s = r + g + b
            if y >= 262 and x >= 392 and s > 380 and chroma < 42:
                px[x, y] = (0, 0, 0, 0)

    # Tight crop to visible pixels
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} size={im.size}")


if __name__ == "__main__":
    main()

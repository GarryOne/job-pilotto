#!/usr/bin/env python3
"""Builds every Jobadabra icon from the vector mark in tools/brand_mark.py.

    python3 tools/brand.py

- desktop app icon (Dock, installer): the yellow tile with the black hat (brand/app-icon.png);
- sidebar and website header: today's near-black tile with an amber outline and the yellow hat (brand/app-logo-128.png, site-logo.png);
- favicon, Chrome extension, GitHub App, social image: the yellow tile at each size (brand/icon-<size>.png);
- the vector marks as SVG (brand/logo-*.svg, favicon.svg).
"""
from pathlib import Path
import shutil

from PIL import Image, ImageDraw, ImageFilter

import brand_mark as mm

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / 'brand'
AMBER = (245, 165, 36)
INK = (21, 23, 28, 255)


def ink_tile(mark, size, inset, radius, fill, glow=True, line=None):
    """The Ink tile: amber glow behind, near-black rounded square, thin amber outline, the mark centred."""
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    box = (inset, inset, size - 1 - inset, size - 1 - inset)
    line = line or max(1, round(size / 90))
    if glow:
        halo = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(halo).rounded_rectangle(box, radius, outline=AMBER + (150,), width=line * 3)
        out = Image.alpha_composite(out, halo.filter(ImageFilter.GaussianBlur(size / 45)))
    shape = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shape).rounded_rectangle(box, radius, fill=INK, outline=AMBER + (255,), width=line)
    out = Image.alpha_composite(out, shape)
    m = mark.copy()
    m.thumbnail((int((size - 2 * inset) * fill),) * 2, Image.LANCZOS)
    out.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return out


def main():
    # The Jobadabra mark (vector, tools/brand_mark.py): the app icon is the yellow tile with the black hat; the sidebar,
    # site header and favicons use today's Ink tile (near-black, thin amber outline) with the yellow hat.
    mark_dark = mm.draw('dark', 1000)
    icon = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    ImageDraw.Draw(icon).rounded_rectangle((100, 100, 923, 923), 185, fill=mm.YELLOW)
    m = mm.draw('tile', 640)
    icon.alpha_composite(m, ((1024 - 640) // 2, (1024 - 640) // 2 + 20))
    icon.save(BRAND / 'app-icon.png')
    ink_tile(mark_dark, 136, 4, 30, 0.86, glow=False, line=6).save(BRAND / 'app-logo-128.png')
    ink_tile(mark_dark, 136, 4, 30, 0.86, glow=False, line=7).save(BRAND / 'site-logo.png')
    mm.draw('dark', 96).save(BRAND / 'logo-mark-ink.png')
    mm.draw('light', 512).save(BRAND / 'logo-mark.png')
    for on in ('light', 'dark', 'tile'):
        (BRAND / f'logo-{on}.svg').write_text(mm.svg(on, background=on != 'light') if on != 'light' else mm.svg(on))
    # Favicon and extension icons: the yellow tile at the sizes a toolbar reads best.
    for size in (16, 32, 48, 128, 180, 512):
        t = Image.new('RGBA', (size * 4, size * 4), (0, 0, 0, 0))
        ImageDraw.Draw(t).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), max(3, size // 5) * 4, fill=mm.YELLOW)
        inner = mm.draw('tile', int(size * 4 * 0.82))
        t.alpha_composite(inner, ((size * 4 - inner.width) // 2, (size * 4 - inner.height) // 2 + size // 6))
        t.resize((size, size), Image.LANCZOS).save(BRAND / f'icon-{size}.png')
    (BRAND / 'favicon.svg').write_text(mm.svg('tile', background=True).replace('<rect ', '<rect rx="40" '))

    copies = {'logo-mark-ink.png': ['web/public/images/logo-mark.png'], 'site-logo.png': ['web/public/images/site-logo.png'], 'app-icon.png': ['desktop/assets/icon.png'], 'app-logo-128.png': ['desktop/renderer/logo.png'],
              'icon-128.png': ['web/public/images/logo.png', 'extension/icons/icon-128.png'],
              'icon-32.png': ['web/public/favicon-32.png', 'extension/icons/icon-32.png'],
              'icon-16.png': ['extension/icons/icon-16.png'], 'icon-48.png': ['extension/icons/icon-48.png'],
              'icon-180.png': ['web/public/apple-touch-icon.png'], 'icon-512.png': ['web/public/images/logo-512.png']}
    for name, targets in copies.items():
        for target in targets:
            shutil.copyfile(BRAND / name, ROOT / target)
    print('Built brand/ icons (Jobadabra): the app icon, the sidebar logo, the favicon and the extension icons.')

if __name__ == '__main__':
    main()

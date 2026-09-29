#!/usr/bin/env python3
"""Builds every Job Pilotto icon from the logo artwork in brand/.

    python3 tools/brand.py

Two versions of the same JP mark:
- desktop app: brand/logo-tile-original.png, recoloured "Ink" (near-black tile, amber outline, cream JP, amber
  plane) -> the macOS icon and the sidebar logo (brand/app-icon.png, brand/app-logo-128.png);
- everywhere else (website, favicon, Chrome extension, GitHub App): the same Ink tile -> brand/icon-<size>.png.
  Both marks are also saved transparent (brand/logo-mark*.png).
"""
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / 'brand'
APP_TILE = (246, 248, 251, 255)  # the desktop artwork's off-white tile
WHITE = (255, 255, 255, 255)


def cut_mark(path):
    """The logo's coloured shapes on a transparent background (tile and page white removed)."""
    source = Image.open(path).convert('RGBA')
    flat = Image.new('RGBA', source.size, (255, 255, 255, 255))
    flat.alpha_composite(source)  # transparent areas count as white (plain convert('RGB') makes them black)
    rgb = np.array(flat.convert('RGB')).astype(int)
    light = rgb.min(axis=2)                     # near-white/off-white pixels are background
    alpha = np.clip((236 - light) * 255 // 40, 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb.astype(np.uint8), alpha])
    ys, xs = np.where(alpha > 60)
    pad = 8
    box = (xs.min() - pad, ys.min() - pad, xs.max() + 1 + pad, ys.max() + 1 + pad)
    return Image.fromarray(rgba, 'RGBA').crop(box)


def tile(mark, size, inset, radius, fill, shadow=False, colour=WHITE):
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if shadow:
        s = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(s).rounded_rectangle((inset, inset + size // 70, size - inset, size - inset + size // 70), radius, fill=(0, 0, 0, 70))
        out = Image.alpha_composite(out, s.filter(ImageFilter.GaussianBlur(size / 55)))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, size - 1 - inset, size - 1 - inset), radius, fill=255)
    out.paste(Image.new('RGBA', (size, size), colour), (0, 0), mask)
    m = mark.copy()
    m.thumbnail((int((size - 2 * inset) * fill),) * 2, Image.LANCZOS)
    out.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return out


# "Ink" (owner's choice, 29 Sep 2026): a near-black tile with a thin amber outline and glow; the JP letters warm
# off-white, the paper plane and the dot amber.
INK = (21, 23, 28, 255)
CREAM = (244, 238, 227)
AMBER = (245, 165, 36)
NAVY_SOURCE, ORANGE_SOURCE = np.array([16, 32, 64]), np.array([220, 84, 10])


def ink_mark(mark):
    """The app mark in Ink colours: each pixel goes to cream or amber by which source colour it's nearer."""
    rgba = np.array(mark).astype(int)
    rgb = rgba[:, :, :3]
    near_navy = np.linalg.norm(rgb - NAVY_SOURCE, axis=2) <= np.linalg.norm(rgb - ORANGE_SOURCE, axis=2)
    out = np.where(near_navy[:, :, None], np.array(CREAM), np.array(AMBER))
    return Image.fromarray(np.dstack([out, rgba[:, :, 3]]).astype(np.uint8), 'RGBA')


def ink_tile(mark, size, inset, radius, fill, glow=True):
    """The Ink tile: amber glow behind, near-black rounded square, thin amber outline, the mark centred."""
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    box = (inset, inset, size - 1 - inset, size - 1 - inset)
    line = max(1, round(size / 90))
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
    app_mark = cut_mark(BRAND / 'logo-tile-original.png')
    app_mark.save(BRAND / 'logo-mark-app.png')
    ink = ink_mark(app_mark)
    ink_tile(ink, 1024, 100, 185, 0.70).save(BRAND / 'app-icon.png')  # macOS icon margins
    ink_tile(ink, 128, 3, 26, 0.80, glow=False).save(BRAND / 'app-logo-128.png')
    # The website's header: the mark alone (no tile) on the dark site, 96 px high for sharp retina.
    alone = ink.copy()
    alone.thumbnail((10_000, 96), Image.LANCZOS)
    alone.save(BRAND / 'logo-mark-ink.png')

    mark = cut_mark(BRAND / 'logo-original.png')
    mark.save(BRAND / 'logo-mark.png')
    # Everywhere else (favicon, website, Chrome extension) in the same Ink look as the app, 29 Sep 2026.
    for size in (16, 32, 48, 128, 180, 512):
        ink_tile(ink, size, 0, max(3, size // 5), 0.80, glow=False).save(BRAND / f'icon-{size}.png')

    copies = {'logo-mark-ink.png': ['site/public/images/logo-mark.png'], 'app-icon.png': ['desktop/assets/icon.png'], 'app-logo-128.png': ['desktop/renderer/logo.png'],
              'icon-128.png': ['site/public/images/logo.png', 'extension/icons/icon-128.png'],
              'icon-32.png': ['site/public/favicon-32.png', 'extension/icons/icon-32.png'],
              'icon-16.png': ['extension/icons/icon-16.png'], 'icon-48.png': ['extension/icons/icon-48.png'],
              'icon-180.png': ['site/public/apple-touch-icon.png'], 'icon-512.png': ['site/public/images/logo-512.png']}
    for name, targets in copies.items():
        for target in targets:
            shutil.copyfile(BRAND / name, ROOT / target)
    print('Built brand/ icons (Ink): the app icon, the sidebar logo, the favicon and the extension icons.')

if __name__ == '__main__':
    main()

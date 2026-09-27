#!/usr/bin/env python3
"""Builds every Job Pilotto icon from the logo artwork in brand/.

    python3 tools/brand.py

Two versions of the same JP mark:
- desktop app: brand/logo-tile-original.png (app navy and orange, off-white tile) -> the macOS icon and
  the sidebar logo (brand/app-icon.png, brand/app-logo-128.png);
- everywhere else (website, favicon, Chrome extension, GitHub App): brand/logo-original.png (white) ->
  brand/icon-<size>.png. Both marks are also saved transparent (brand/logo-mark*.png).
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


def main():
    app_mark = cut_mark(BRAND / 'logo-tile-original.png')
    app_mark.save(BRAND / 'logo-mark-app.png')
    tile(app_mark, 1024, 100, 185, 0.74, shadow=True, colour=APP_TILE).save(BRAND / 'app-icon.png')  # macOS icon margins
    tile(app_mark, 128, 0, 26, 0.86, colour=APP_TILE).save(BRAND / 'app-logo-128.png')

    mark = cut_mark(BRAND / 'logo-original.png')
    mark.save(BRAND / 'logo-mark.png')
    for size in (16, 32, 48, 128, 180, 512):
        tile(mark, size, 0, max(3, size // 5), 0.86).save(BRAND / f'icon-{size}.png')

    copies = {'app-icon.png': ['desktop/assets/icon.png'], 'app-logo-128.png': ['desktop/renderer/logo.png'],
              'icon-128.png': ['site/public/images/logo.png', 'extension/icons/icon-128.png'],
              'icon-32.png': ['site/public/favicon-32.png', 'extension/icons/icon-32.png'],
              'icon-16.png': ['extension/icons/icon-16.png'], 'icon-48.png': ['extension/icons/icon-48.png'],
              'icon-180.png': ['site/public/apple-touch-icon.png'], 'icon-512.png': ['site/public/images/logo-512.png']}
    for name, targets in copies.items():
        for target in targets:
            shutil.copyfile(BRAND / name, ROOT / target)
    print('Built brand/ icons: the desktop app from logo-tile-original.png, everything else from logo-original.png.')

if __name__ == '__main__':
    main()

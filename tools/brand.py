#!/usr/bin/env python3
"""Builds every Job Pilotto icon from the logo artwork in brand/.

    python3 tools/brand.py

Reads brand/logo-tile-original.png (the JP mark on an off-white tile), cuts the mark out of its
background, and writes: brand/logo-mark.png (transparent), brand/app-icon.png (macOS icon),
brand/icon-<size>.png (small sizes), then copies them to the Mac app, the Chrome extension and the site.
"""
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / 'brand'
TILE = (246, 248, 251, 255)  # the artwork's off-white tile


def cut_mark(path):
    """The logo's coloured shapes on a transparent background (tile and page white removed)."""
    rgb = np.array(Image.open(path).convert('RGB')).astype(int)
    light = rgb.min(axis=2)                     # near-white/off-white pixels are background
    alpha = np.clip((236 - light) * 255 // 40, 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb.astype(np.uint8), alpha])
    ys, xs = np.where(alpha > 60)
    pad = 8
    box = (xs.min() - pad, ys.min() - pad, xs.max() + 1 + pad, ys.max() + 1 + pad)
    return Image.fromarray(rgba, 'RGBA').crop(box)


def tile(mark, size, inset, radius, fill, shadow=False):
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if shadow:
        s = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(s).rounded_rectangle((inset, inset + size // 70, size - inset, size - inset + size // 70), radius, fill=(0, 0, 0, 70))
        out = Image.alpha_composite(out, s.filter(ImageFilter.GaussianBlur(size / 55)))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, size - 1 - inset, size - 1 - inset), radius, fill=255)
    out.paste(Image.new('RGBA', (size, size), TILE), (0, 0), mask)
    m = mark.copy()
    m.thumbnail((int((size - 2 * inset) * fill),) * 2, Image.LANCZOS)
    out.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return out


def main():
    mark = cut_mark(BRAND / 'logo-tile-original.png')
    mark.save(BRAND / 'logo-mark.png')
    tile(mark, 1024, 100, 185, 0.74, shadow=True).save(BRAND / 'app-icon.png')   # macOS icon grid margins
    for size in (16, 32, 48, 128, 180, 512):
        tile(mark, size, 0, max(3, size // 5), 0.86).save(BRAND / f'icon-{size}.png')
    copies = {'app-icon.png': ['desktop/assets/icon.png'], 'icon-128.png': ['desktop/renderer/logo.png', 'site/public/images/logo.png'],
              'icon-32.png': ['site/public/favicon-32.png'], 'icon-180.png': ['site/public/apple-touch-icon.png'],
              'icon-512.png': ['site/public/images/logo-512.png'],
              **{f'icon-{s}.png': [f'extension/icons/icon-{s}.png'] for s in (16, 48)}}
    copies['icon-32.png'].append('extension/icons/icon-32.png')
    copies['icon-128.png'].append('extension/icons/icon-128.png')
    for name, targets in copies.items():
        for target in targets:
            shutil.copyfile(BRAND / name, ROOT / target)
    print('Built brand/ icons and copied them to the app, extension and site.')


if __name__ == '__main__':
    main()

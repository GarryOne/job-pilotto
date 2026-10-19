# Jobadabra brand

The logo: a magician's top hat with a J on its body and a spark rising out of its opening. One vector definition, `tools/brand_mark.py`
(shapes in a 200 × 200 box, three colourways); everything else is built from it.

| Where | Look | Built files |
|---|---|---|
| Desktop app icon (Dock, installer) | yellow tile, black hat | `app-icon.png` |
| Sidebar, website header | near-black tile with an amber outline, yellow hat | `app-logo-128.png`, `site-logo.png`, `logo-mark-ink.png` |
| Favicon, Chrome extension, GitHub App, social image | yellow tile, black hat | `icon-<size>.png` (16, 32, 48, 128, 180, 512), `favicon.svg` |
| Vector marks | `logo-light.svg` (on light), `logo-dark.svg` (on dark), `logo-tile.svg` (on yellow) | |

`logo-mark.png` is the hat for light backgrounds. The wordmark is text in the app's own font (the design and colours are unchanged).

Rebuild after changing the mark: `python3 tools/brand.py` (writes brand/ and copies the icons into desktop/, extension/ and site/),
then `cd desktop && npm run screenshots` for the website.

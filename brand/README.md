# Job Pilotto brand

The logo: a JP monogram whose line takes off as a paper plane. Two versions of the same mark:

| Where | Artwork | Built files |
|---|---|---|
| Desktop app (macOS icon, sidebar) | `logo-tile-original.png`: app navy and burnt orange on an off-white tile | `app-icon.png`, `app-logo-128.png`, `logo-mark-app.png` |
| Everywhere else (website, favicon, Chrome extension, GitHub App, social image) | `logo-original.png`: brighter orange, on white | `icon-<size>.png` (16, 32, 48, 128, 180, 512), `logo-mark.png` |

`logo-mark*.png` are transparent: light backgrounds only (the J and P are navy). On dark backgrounds
always use a tile.

Rebuild after changing either artwork: `python3 tools/brand.py` (writes brand/ and copies the icons into
desktop/, extension/ and site/), then `cd desktop && npm run screenshots` for the website.

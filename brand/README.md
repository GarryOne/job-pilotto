# Job Pilotto brand

The logo: a JP monogram whose line takes off as a paper plane, in the app's slate navy and burnt orange,
on an off-white rounded tile.

- `logo-tile-original.png`: the artwork (source of everything below).
- `logo-original.png`: the first version (brighter orange, white background), kept for reference.
- `logo-mark.png`: the mark alone, transparent. Light backgrounds only (the J and P are navy).
- `app-icon.png`: macOS app icon (1024 px, tile with the standard macOS margins).
- `icon-<size>.png`: the tile at small sizes: Chrome extension (16/32/48/128), favicon (32),
  Apple touch icon (180), app sidebar and website logo (128), social image (512).

Rebuild after changing the artwork: `python3 tools/brand.py` (writes brand/ and copies the icons
into desktop/, extension/ and site/), then `cd desktop && npm run screenshots` for the website.

Colours: navy #1B2B44 / sidebar #132439, orange #D9540B, tile #F6F8FB.
On dark backgrounds always use the tile (`icon-*.png`), never the transparent mark.

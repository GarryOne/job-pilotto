# Product media: screenshots and videos that remake themselves

Owner, 20 Oct 2026: "I want me doing nothing and everything being done automatically, with AI." Sketch approved the same day
(https://claude.ai/artifact/3JNoLY2QHGiuH5vkuJkjNf): effects in code + Claude as director, pipeline in this repo, auto re-run on main.
Persona: keep today's demo person (SRE) for now; re-recording with another search profile must be one option (`--persona <folder>`).

## How it works
- `npm run media` (desktop/scripts/media/media.mjs): records the app (demo mode, dark, hidden window, temp copy of the persona folder) and the real
  extension filling a fictional form (form.html at a reserved `.example` address, e2e harness isolation), renders zoom/cursor/click from the click
  log in code (camera.mjs + render.cjs: real pixels only), checks (check.mjs), encodes (encode.mjs), writes `manifest.json` (manifest.mjs).
- Director: `node scripts/media/direct.mjs <piece>` (Claude on the subscription, never in CI) writes `plans/<piece>.json` (zoom per look, caption).
- CI: `.github/workflows/product-media.yml` on main after screen/extension/demo/scene changes → artifact `product-media` (manifest.json at
  its root); the site's deploy in job-pilotto-site pulls the newest one into `site/public/media/` (session 6e, 20 Oct 2026: read-only, no app).
- Pieces and formats agreed with the site redesign (bd): hero, extension-fill, stills, snips; dark only; captions in the manifest only.

## Progress
- [x] Sketch + owner's decisions (20 Oct 2026) (proof: none: the owner's answers in session 7d; the sketch link above)
- [x] Recorder: app (screencast + click log) and the real extension on a fictional form (proof: desktop/scripts/media/record-extension.mjs)
- [x] Renderer: zoom, cursor, click ring from the log; MP4/WebM/phone/GIF/poster within budget (proof: desktop/test/media-camera.test.js)
- [x] Stills + close-ups (WebP), manifest, checks (fictional e-mails only, dark, the form filled, capture rate) (proof: desktop/test/media-check.test.js)
- [x] Director (`direct.mjs`) + plans folder (proof: desktop/scripts/media/plans/hero.json)
- [x] CI workflow (artifact `product-media`) (proof: .github/workflows/product-media.yml)
- [x] Nurse-in-Lyon persona (owner, 20 Oct 2026), the media's default; dates shift to the recording week; the default person's words refused (proof: desktop/test/media-persona.test.js)
- [x] Stills fill the window (CDP capture), close-ups at 2x, Strategy waited for, extension poster = the filled form (proof: desktop/test/media-persona.test.js, desktop/test/media-camera.test.js)
- [ ] apply-split (browser + app side by side) for /how-it-works
- [x] First director plans committed for hero and extension-fill (proof: desktop/scripts/media/plans/hero.json, plans/extension-fill.json)
- [ ] The site's deploy pulls the artifact (6e, after the site is live)
- [ ] Retire site-demo.mjs / apply-demo.mjs once the site uses the new set

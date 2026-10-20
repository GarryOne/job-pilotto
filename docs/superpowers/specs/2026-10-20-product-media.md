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
- [x] Sketch + owner's decisions (20 Oct 2026)
- [x] Recorder: app (screencast + click log) and the real extension on a fictional form
- [x] Renderer: zoom, cursor, click ring from the log; MP4/WebM/phone/GIF/poster within budget
- [x] Stills + close-ups (WebP), manifest, checks (fictional e-mails only, dark, the form filled, capture rate)
- [x] Director (`direct.mjs`) + plans folder
- [x] CI workflow (artifact `product-media`)
- [ ] apply-split (browser + app side by side) for /how-it-works
- [ ] First director plans committed for hero and extension-fill
- [ ] The site's deploy pulls the artifact (6e, after the site is live)
- [ ] Retire site-demo.mjs / apply-demo.mjs once the site uses the new set

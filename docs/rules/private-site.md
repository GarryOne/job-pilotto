# The website and /admin live in a private repo

Owner, 19 Oct 2026: "leave open-source rather less than more … make it hard for someone to copy our product from the source code". Moved 20 Oct 2026 (private spec job-pilotto-internal:docs/specs/2026-10-19-site-private-repo.md).

## What is where
- **Private, `GarryOne/job-pilotto-site`** (clone: `~/job-pilotto-site`): `site/` (the www Worker, /admin, D1 migrations, ready and hosted runners, its tests), `site-next/`, the jobs that feed /admin (ops overview, changelog, daily digest, e2e-intel, hosted e2e, the Lab Job Search uploads) and their workflows.
- **Public, here**: the desktop app, extension, engine (`src/`), the Telegram bot Worker (`worker/`), the hosted image (`hosted/`), the tests of all of those, and **`docs/site-routes.json`**: the list of every route the app, extension and engine call, with a kind. The public tests `desktop/test/site-routes.test.js` (code calls only listed routes) and the site's `site/test/site-routes.test.js` (the Worker answers each) pair on it.
- **The rule: private may read public, public never reads private.** The private repo works inside a tree of this repo with its own files laid over it (`tools/overlay.sh`, `tools/tree.sh` there).

## What it means for your change
- **A new route the app calls**: add it to `docs/site-routes.json` here and the Worker route in the private repo (the public test fails until it is listed; the private test fails until the Worker answers it).
- **A test that reads a `site/` file** uses `tests/site_private.py` (`@needs_site`) or `desktop/test/site-private.js` (`siteTest`): it is skipped here and runs in the private repo's CI (daily against the newest public main too).
- **Shared tables** the public pool and eval tools need live here: `desktop/e2e/lib/platform.mjs`, `applying-status.mjs`, `desktop/lib/free-ai-models.js`, `free-ai-translate.js`, `desktop/test/fixtures/host-cases.json`. The site re-exports them.
- **Reading the admin tools** from here (needs-fix-causes and friends): `~/job-pilotto-site/tools/site-run.sh node tools/needs-fix-causes.mjs`.
- **Editing the site**: in `~/job-pilotto-site` (its own worktrees and PRs). A public PR cannot start a workflow there; `public-watch.yml` there looks every 6 hours and starts a deploy when a public file the site bundles changed.
- Everything pushed before 20 Oct 2026 stays in this repo's history and in forks.

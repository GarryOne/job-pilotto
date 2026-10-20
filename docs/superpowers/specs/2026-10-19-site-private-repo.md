# Move the website and /admin to a private repo

Owner, 19 Oct 2026: "start an initiative to move the site and admin off the github public repo. Let it be on a separate private repo", widened: "leave open-source rather less than more … make the job hard of someone trying to copy our product from the source code".
Sketch the owner approved: https://claude.ai/artifact/CGXScfWVWiWWqveissear9 (new repo `GarryOne/job-pilotto-site`; public part = a route list + two checks, no fake site; no history rewrite; safety net first, the move after sessions 1e and 19 merge).

## Rule
Private may read public; **public never reads private.** The site repo checks out the public repo at a pinned commit (`PUBLIC_REF`) and imports its shared validators as it does today (`../../extension/…`). What the public side keeps of the site is `docs/site-routes.json`.

## Data ownership
No user data moves. The site's D1/KV/R2 stay where they are; the Worker keeps its name `www`, its URLs and its bindings. Only where the code lives changes.

## Steps
- PR A (this one): the route list and the two checks. No site file changes.
- PR B: the move, after 1e (jobadabra.top) and 19 (rename) have merged. Owner actions it needs: create the repo, set its secrets (Cloudflare token and account id, three publish keys), a read token for the public checkout, the cutover (one deploy path at a time).
- Later rungs (each its own yes): eval data, licence-gated reads, prompts behind the Worker, engine, app and extension. Only the server side is protected; shipped JS can only be obfuscated.

## Progress
- [x] Route list `docs/site-routes.json`, 82 routes with kind and methods (proof: docs/site-routes.json)
- [x] Site check: the Worker answers every listed route and lists every route it has (proof: site/test/site-routes.test.js)
- [x] Public check: every `/api` or `/report` route shipped code writes is listed, listed app routes are still called (proof: desktop/test/site-routes.test.js)
- [x] `GarryOne/job-pilotto-site` created (private, by the session at the owner's word, 19 Oct 2026) and pushed (proof: none: repo state)
- [ ] Owner sets the repo's secrets (list in `docs/rules/private-site.md`) (proof: none: owner action)
- [x] Everything that imports `site/` moved in one PR B: shared tables went public, drift guards skip here and run there (proof: tests/site_private.py, desktop/test/site-private.js)
- [x] Move `site/`, `site-next/`, site workflows, site-only tools and the Lab workflows; public docs point to the new repo (proof: docs/rules/private-site.md)
- [ ] Cutover: the first private deploy answers every listed route BEFORE this PR is merged; then the public `site.yml` is gone (proof: none: owner merges after the proof)

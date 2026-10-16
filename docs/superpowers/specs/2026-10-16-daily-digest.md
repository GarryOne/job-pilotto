# Daily build digest: what we built today, in 3 places

Owner, 16 Oct 2026: "That's a very nice format. How we can have this every day. Updated constantly... I'd like to look back and see every day what we've built, achieved."
Where: "Admin page with history", "Build Log Telegram bot", and a public changelog "rather per version, than weekly". OK to spend ~$2-5/month of AI (Haiku).

## Verdict
🗓️ Every day one digest, grouped by goal, in plain words: a draft on the admin page that refreshes after merges, the final one in Telegram at 23:00 Zurich, and a per-version public /changelog the owner approves.

## Format (the one the owner liked)
- Intro (written by code, never the AI): "Here's what we achieved today, 16 Oct, grouped by goal. About N PRs merged, from #A to #B."
- 3-9 groups, each an emoji + goal heading (e.g. 🧭 Apply flow on real ATS sites, 🤖 Free AI, 🔐 Accounts and data, 🧪 Quality and CI); 2-5 bullets each:
  a **bold lead** + one plain sentence of what changed for the user, measured numbers when the PR has them, PR numbers in brackets (#999, #972-#1029).
- Ends with "**Still open:** ..." (one line, from the open PRs). No jargon, no session names.

## Design
1. **Source** (`tools/daily-digest.mjs`, `gh`): PRs merged that day (Europe/Zurich) + open PRs' titles. Per PR only the title, the verdict line, the "What changed" bullets and the Before/After row (`summarize` in `site/src/build-digest.js`), ≤ 400 characters: ~60 tokens each.
2. **Generator** (`site/src/build-digest.js`, pure; the CLI calls it): Haiku through the Messages API answers a FIXED JSON shape (`{groups:[{emoji,title,bullets:[{lead,text,prs}]}], open}`);
   code validates it (PR numbers must be in the input, lengths, counts, every PR in some bullet or listed under "Smaller changes"), writes the intro and renders markdown. A bad answer is retried once, then the day keeps its last good draft.
3. **Cost:** key `DIGEST_ANTHROPIC_KEY` (the Self-heal workspace key, no fallback: a missing key fails loudly; never Free AI / Workers AI); job id `daily-digest` reported to /admin/ai-cost. A draft is rebuilt only when a PR merged since the last one, at most once an hour and 8 a day (≈ $0.01 a call, $2-4 a month).
4. **Storage + admin:** table `digest_days` (migration 0080 `digest_days`): day, draft/final markdown, JSON groups, PR count/range, `final_at`. `PUT /digest/data` (Bearer SELFHEAL_PUBLISH_KEY, like /ops/data); page `/admin/operations/build-log` (in the Operations group of `site/src/admin.js`): today's draft on top, a day-by-day history to scroll back, ?day=.
5. **Telegram:** workflow `daily-digest.yml` (hourly draft; 21:00 UTC = 23:00 Zurich in summer, 22:00 UTC in winter: runs both and posts once, `final_at` guards) posts the final digest through the Build Log bot (secret `BUILDLOG_TELEGRAM_TOKEN`, Keychain `job-pilotto.telegram.buildlog_token`, chat id `BUILDLOG_TELEGRAM_CHAT`). Without a token the post is skipped with a notice, tests use a fake.
6. **Public /changelog, per version** (`site/public/changelog.html`, from `site/public/changelog.json`; `site-next` only redirects non-page paths to the live site, so no copy is needed there): one entry per STABLE app release, user-visible changes only, rewritten for users.
   NOTHING internal (no test accounts, outages, costs, CI, session names) and no Pro price or plan before Pro launches. Draft per version by `tools/changelog-draft.mjs` (the same Haiku path, from the commits/PRs between two stable tags), a human-approved entry is committed to the JSON by the owner's yes only (never published by the job).

## Progress
- [x] Spec merged (#1085)
- [x] PR A (#1086): generator (`site/src/build-digest.js`, `tools/daily-digest.mjs`), unit tests on the #957-#1082 fixture, no live AI (proof: site/test/build-digest.test.js)
- [x] PR B (#1088): D1 table + `/digest/data` + admin page + workflow + AI cost row (proof: site/test/build-log.test.js, screenshot in the PR)
- [x] PR C (#1089): Telegram post (fake-tested; live needs the owner's bot token) (proof: site/test/build-digest-telegram.test.js)
- [ ] PR D: /changelog page + draft tool + leak guard test
- [ ] Owner: create the Build Log bot with @BotFather, give the token + chat id

## Not in scope
Weekly rollups, per-user digests, editing a digest in the page (a wrong day is regenerated).

# Free AI on Cloudflare Workers AI (16 Oct 2026)

**Verdict:** "Free" = a site-worker route that answers the app's Anthropic-shaped calls with an open model on Workers AI. No $1 credit, no key, no founder key. Nobody's machine holds a Cloudflare key.
Owner (16 Oct): "just 'Free', without 1$ credit. Basically we'll assume it's unlimited." / bigger Free card, two smaller cards below with the OpenAI / Anthropic logos.

## What exists today (history, one line)
`aa53563` (30 Sep) trial relay: `site/src/trial.js` forwards `/api/ai/v1/messages` to Anthropic with the Worker secret `ANTHROPIC_TRIAL_KEY`;
only owner-signed license keys (`JP1.…`), $1/key + $20/month in KV; `2026-10-02` per-step cost log (`aicost.js` → D1 `ai_calls`); `85ef806` streaming; `0a84fe6` start() sets `aiEngine:'api'`.
The app flips `ANTHROPIC_BASE_URL` (JS app `lib/ai-trial.js`, Python `lib/pipeline-env.js`), so **both SDKs already follow one variable**: the cheapest swap is to keep the Anthropic-shaped endpoint and change what answers behind it.

## Design
1. **Where it runs:** the same `/api/ai/v1/messages` route. `trial.js` becomes `free-ai.js`: translate Anthropic Messages (system, messages, tools/`output_config` JSON schema, streaming) → Workers AI `env.AI.run(model, …)` (OpenAI-compatible chat, `response_format: json_schema`) → Anthropic-shaped reply (+ `usage`). Requests carry `x-jp-action` (already sent), so **model per task** is a table in the worker:
   `score/enrich/mail/inbox/decide/import/scout/added/review` → small fast model (Qwen3-30B-A3B class); `kit/prep/insight/interview/opportunity` and form answers → stronger model (GLM-Flash class). Final names come from the measurement (§Quality), not from the shortlist.
2. **Auth without a founder key:** the existing install token (`guard.js` `tokenFor/authorize`, purpose `'ai'`, from `/api/install-token`) replaces `JP1.` license keys. Revoked installs (honeypot) are refused as elsewhere. License keys still work (same limits).
3. **Unlimited, safely** (numbers to confirm with owner):
   | Guard | Value |
   |---|---|
   | per install, per minute | 30 calls |
   | per install, per day | 300 calls and 1.5M tokens |
   | global per day | $3 → Telegram alert; $10 → route answers 503 "Free AI is busy, try again later" (kill switch also `FREE_AI=off` var) |
   | kill switch | `FREE_AI=off` → app shows "Free AI is paused; add your own key", never silent |
   Counters in KV (`WAITLIST`) like today; cost per call from Workers AI token prices into `ai_calls` (model name distinguishes it); `/admin/ai-cost` gets a "Workers AI" section (it already groups by model; add the price table + daily line).
   Budget check (owner's own estimate): 100 users × 10 req/day ≈ $8/month; free tier 10k neurons/day first, then Workers Paid $5/mo (**needs the owner's yes**).
4. **Where the $1 credit lives (the class to remove, same change):** wizard card + key field (`wizard.js`, `index.html` `ai-trial*`), Settings engine card, `ai-engine-view.js` TEXT (trial, notes mentioning "free-credit relay"), ⌘K entry, `claude-session.js`/`github.js` mentions, `pending-license.js` (installer key → no longer starts a credit), `friends.html` (site and site-next), `site/src/install.js` + `telemetry.js` words, README + `docs/ARCHITECTURE.md`, `wrangler.toml` vars (`TRIAL_*`), tests (`ai-trial`, `engine-free-credit-card`, `pending-license`, `claude-code`, `site/test/trial`, `telemetry`). Intelligence page: states which AI steps run on which engine, updated when the model table is final. A grep guard test fails on "credit"/"$1 of" in user-facing strings.
   **Existing trial users → Free automatically** (settings `aiTrial` stays the flag, renamed `aiFree` with a migration read of the old name); the secret `ANTHROPIC_API_KEY` that holds their `JP1.` key is dropped when it is a trial key.
   **Question for the owner:** keep `ANTHROPIC_TRIAL_KEY` (Internal/Trial workspace, $10) for the CI/tests or retire it? Proposal: retire the route's use now; keep the workspace key until the measurement is read.
5. **Picker:** the segmented "Claude | OpenAI" switch goes. Layout: one large **Free** card (sparkle, plain words: "Free. Nothing to set up. No account, no key." + 1 line on quality "Good for most jobs; for the best CVs add your own key later"), under it a row of two small cards **Claude** and **OpenAI** (official marks as small SVG in `desktop/renderer/assets/`, "Use your own key or subscription"); picking one opens that family's two cards (API key / CLI) in a panel below, same component as today. Reuses `choiceCards`, tokens; new CSS only for the large/small sizing scoped under `.engine-picker`. Every state kept (CLI status, fallback, offer, notice). Same component for the wizard and Settings (today the credit card was wizard-only; Free is in both). ⌘K: "Use Free AI", "Use my Claude key / Claude Code", "Use my OpenAI key / Codex". Before/after shots (`npm run shot`).

## Quality: measure first (cents, no user switched before the table is read)
Run through the worker's translation layer so the test covers it too. Needs an `AI`-capable account: **Workers AI is on the free tier; no Paid plan needed for this run (a few hundred calls, under the 10k neurons/day), spread over days if needed.**
| Task | Data | Compare |
|---|---|---|
| Fit scores | stored jobs (SQLite, ~100) | open model vs Claude Haiku/Sonnet score: rank correlation, same top-20, schema-valid % |
| Enrich/extract | same jobs | fields equal to Claude's |
| Form answers | offline replays + answer-reask tool | wrong-value count vs Claude on the recorded rows |
| CV / kit draft | 3 jobs side by side | owner reads; schema-valid %, invented-fact check |
A task where the open model is clearly worse says so; then: keep it on the stronger Workers AI model, or ask for a paid engine for that task only (the app already shows a plain "needs your own key for this" line, never a silent bad result). Weak or invalid JSON → retry once on the stronger model (server side), then error.

## Owner answers (16 Oct, via job-pilotto-cc)
- Retire `ANTHROPIC_TRIAL_KEY`: **yes** (the route no longer uses it; delete the Worker secret after PR 1 is deployed).
- Limits as proposed: **yes**.
## Found while building
- GLM-5.3 Flash needs the **Workers Paid** plan; Qwen3-30B-A3B runs on the free tier. PR 1 ships with `STRONG_ON="off"` (all steps on the small model); the switch flips when Paid is on.
- CV steps send the PDF as a `document` block: the route reads it with `env.AI.toMarkdown`; images (the ladder's picture rung) are refused with words, those steps fall to other rungs.
- Old apps keep working: a `JP1.` founder key is still accepted by the route until PR 2 moves them to `JPF1.<install>.<token>`.

## Progress
- [x] Spec read by the owner (via job-pilotto-cc) (proof: none: owner answered "Yes" and "retire" through job-pilotto-cc on 16 Oct)
- [x] Measurement tool `tools/free-ai-eval.mjs` + `tools/free-ai-cases.py` (proof: desktop/test/free-ai-eval.test.js)
- [ ] The quality table in this spec (needs the Workers AI credential; fictional postings only, owner's yes before any real job or CV goes to Cloudflare)
- [x] PR 1 (site): `free-ai.js` route, install-token auth, limits, kill switch, alert, tests (proof: site/test/free-ai.test.js); ai-cost already groups by model, Workers AI prices in `free-ai-models.js`
- [ ] PR 2 (app): credit → Free everywhere in §4 + migration + grep guard
- [ ] PR 3 (UI): picker with logos, ⌘K, before/after shots
- [ ] Owner decisions: trial key fate, Workers Paid yes, limit numbers

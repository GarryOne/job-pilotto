# Why the rules exist: the incidents behind them

Each rule in CLAUDE.md and `docs/rules/` is short; the incident that caused it lives here. **Before "simplifying" a rule, read its entry**: these are
what stop a rule from being relaxed back into the old bug. Add an entry when a new rule is born from an incident (date, what happened, the cost).

## Safety
- **Tests never touch the owner's live app, accounts or data** (8 Oct 2026): a headless browser with the real extension, launched without the
  harness's port rewrite, paired with the live app on 127.0.0.1:47111 and used the real profile, the Keychain password, the real CV and the AI budget on
  an employer's site. Nothing was submitted, but it was a privacy and cost incident. Hence: list what product code reaches, cut it off, assert it,
  always through the harness (`desktop/e2e/lib/extension.mjs`, `real-extension.mjs`), check `logs/app.log` afterwards.
- **The twin** (8 Oct 2026, owner: "test on my current state, on my live websites… while avoiding mutating my actual Notion state"): the one sanctioned
  way to use real state, through a one-way Notion mirror whose token gets 404 on every real database.
- **Login walls and bot checks** (owner, 7 Oct 2026): LinkedIn, Glassdoor, Indeed, levels.fyi and Reddit are read only through the user's own visit;
  401/403/429 or a check is a no.

## Meaning and pages
- **Meaning comes from AI, never keyword lists** (owner, 8 Oct 2026: "AI should interpret mails"): an English-only subject-word Gmail search never
  fetched a German or Portuguese rejection; AI-translated keywords were proposed and refused.
- **Judgments about a page are the AI's, even without words** (8 Oct 2026): "is the form ready?" was HTML `required`, "did it work?" was "the form is
  gone", and bot checks were a list of vendors: all three failed on the first real site.
- **Reading websites is universal** (owner, 8 Oct 2026: "we'll have thousands of them").
- **A form bug is fixed in the mechanism** (8 Oct 2026): per-site fixes did not carry to the next site; upload slots became the example
  (`extension/page/upload.js`, `desktop/e2e/test/upload-slot.test.mjs`).

## Working rules
- **Every fix works for any user, through the Desktop App**: Always on's Google sign-in was once set with `gh secret set` by hand; the app now copies
  it itself (`desktop/lib/google-keys.js`).
- **Keep the Intelligence page in step** (owner, 3 Oct 2026): new AI steps had shipped without the site saying so.
- **Wrong data: root cause first, then repair by hand**: one-off repair code piled up for edge cases that never recurred.

## Data
- **One copy** (28 Sep 2026): an audit found data split across the Mac and Notion, some only local, some duplicated without sync. Hourly/daily sync
  was rejected (two copies = drift). **"Notion later"** (3 Oct 2026) replaced "Notion required at setup"; **store adapters** (9 Oct 2026) made
  Notion optional behind one interface, still one copy.

## Applying
- **Extension first** (owner, 8 Oct 2026): the extension path is easier, faster, simpler; Claude needs Claude Code and suits technical users.
- **Claude finishes a stuck page** (owner, 10 Oct 2026) replaced "never started by itself" (8 Oct) and "hidden, off by default" (9 Oct): users got
  stuck on pages Claude could finish; the countdown keeps the start visible and cancellable.
- **The flow core: one session at a time** (10 Oct 2026): in 8 days `extension/background.js` took 48 commits and `fill-flow.js` 29, from several
  sessions at once; a fix for one site or flow kept breaking another.
- **Recorded pages answer only what was asked** (10 Oct 2026, Ashby Yes/No): a stub answering an unasked question hid the bug.
- **"Do it for me" is the default** (owner, 10 Oct 2026: "users get most of the automation by default"), replacing the 9 Oct assist default.
- **Close a fix only on Confirmed** (11 Oct 2026): fixes closed on "it clears by itself" came back.

## Desktop UI
- **A new feature looks like the old ones** (5 Oct 2026): "Prepare top matches" shipped as raw Telegram text while every other task had a card;
  four cards had drifted from the engine's message format, hence the message contract test.
- **Confirm a mockup before code** (28 Sep 2026): Profile moved and back, Settings saving changed twice, Actions redesigned 3× in one day.
- **Screenshot the whole view** (7 Oct 2026): a box checked alone was indented past its card's heading, spaced far apart, with oversized buttons.
- **But not at Tier 0** (28 Sep 2026): a spinner change lost minutes to three failed offscreen screenshots and CI polling.

## Files
- **500 lines** (8 Oct 2026): a moved block missed `sessionGet` 800 lines below; an import changed upstream and a page went blank.
- **Splitting safely** (8 Oct 2026): `main.js` 2,781 → 1,197 lines took a failed start (`prepareKitFor` needed before it existed) and three near-misses;
  a session had split the contact handlers meanwhile (two files registering one channel).

## Change loop
- **Superpowers plugin dropped** (30 Sep 2026): its process cost more tokens than it saved. **No subagents** (30 Sep 2026): they ate most of the
  token usage and were slow.
- **Change tiers** (6 Oct 2026): a transcription banner took 1–2 hours of harnesses, real downloads, e2e runs and CI waits.
- **Commit subjects ≤ 72 characters** (2 Oct 2026): subjects of 150+ characters made the history unreadable.
- **The e2e step moves with the feature** (6 Oct 2026): about 25 commits in eight hours renamed a task, changed digest headings and the job-board rule
  without touching their suites; the `personas` suite sat red unnoticed.
- **A new e2e step proves its setup** (6 Oct 2026): an Apply step that had never passed failed the beta gate on its premise.
- **No CI e2e by hand** (owner, 9 Oct 2026): a Mac's runs use the plan; CI spends the test keys.
- **One full run per landing** (owner, 10 Oct 2026): the ladder took 40 checklist boxes and the full suites ran about 40 times; "do it in 1 to 3
  commits and run the e2e suites 10x less".
- **Debugging an e2e step** (6 Oct 2026): one step cost ~1 h and 10 full-suite runs of 2-4 minutes; a repro was called done when its stub had
  silently not applied.
- **Never force-push main** (1 Oct 2026): a `--force-with-lease` dropped another session's commit `8dce9ba`.
- **Red main** (5 Oct 2026): four sessions waited for a red build's author until the owner stepped in.
- **Keep worktrees** (owner, 9 + 11 Oct 2026): five landed worktrees were removed against the owner's wish and restored; then 167 worktrees took
  10 GB, hence keep by default + a 7-day prune of fully landed, untouched ones.
- **Run Log and Session Handoff retired** (owner, 11 Oct 2026): of 56 sessions in 7 days only 2 read the Handoff (62 KB, its "Current state"
  dated 3 Oct) and 1 the Technical Reference; the Run Log repeated the commit messages. Lessons now land in stronger forms ([knowledge.md](knowledge.md)).
- **After each change, only what applies** (owner, 11 Oct 2026): Tier 0 targets ~1 minute, but every change was also asked to update three Notion
  pages, a Bug Tracker row, a two-table to-do list and the Intelligence page; agents over-verified and over-reported.

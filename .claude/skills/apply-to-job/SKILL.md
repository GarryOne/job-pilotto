---
name: apply-to-job
description: Fill a job application form for the owner from their Job Pilotto application kit, live in Chrome, stopping before Submit. Use when the owner says "apply to <job/URL>", "fill this application", "help me apply", or pastes a job/application link. Also use to record what was learned about an application form or platform.
---

# Apply to a job (Job Pilotto)

Goal: the owner's application form, fully and correctly filled from the application kit, in their
own Chrome, **stopped before Submit**. The owner reviews and clicks Submit. Then the job is marked
applied. Speed matters: a Greenhouse form should take under 3 minutes.

## Hard rules
- **Never click Submit / Apply / Send.** Stop, show the summary, let the owner click. (Decision Log:
  never auto-apply. Changes only if the owner supersedes that decision there.)
- Only facts from the kit, the Notion Profile, Application Answers and the CV. Never invent.
- Anything marked ❓ in the kit, or a field with no source: leave it empty, list it for the owner.
- **Legal-acknowledgment checkboxes** ("I have read and agree to...", privacy notices, terms) are
  always left for the owner to check themselves, even when the kit supplies an answer for them —
  it's the owner's agreement to make, not something to assert on their behalf. (Adopted 25 Sep 2026
  after observing this as a hard rule in a Codex desktop-app comparison run — see Log.)
- Never fill passwords or create accounts (Workday, SuccessFactors, Taleo ask for one): stop and
  hand over to the owner.
- CAPTCHA or "verify you are human": the owner solves it. Never try to bypass it.
- Contact details (email, phone, address) come from the CV PDF at apply time. Do not store them
  in Notion, the repo or memory.
- **Leak guard.** This file, Platform notes and the Log are committed to a public-ish git history.
  Never write a real name, email, phone, address, salary figure or answer text into them — use
  `<placeholder>` the way this file already does. Findings about a *site* (field ids, widget
  behaviour, error text) are fine; findings about *this application* (what was typed) are not.
- **Always use `browser_batch` for multi-step browser work**, never a string of separate
  `javascript_tool`/`computer`/screenshot calls one at a time. Load it up front (it's a deferred
  tool: `ToolSearch("select:mcp__claude-in-chrome__browser_batch")` alongside the rest of the core
  set) and group whatever steps don't depend on seeing an intermediate result — e.g. one batch for
  "map fields" + "fill text fields", another for "fix a field" + "re-verify" + "screenshot". Adopted
  25 Sep 2026 after direct owner feedback that watching one-call-at-a-time execution (assess, run
  JS, assess again, upload, assess again...) was unacceptably slow; see Log.
  - **Go further: batch as much of the whole form as possible in ONE call, not just pairs of
    steps.** After the initial field-mapping pass tells you every field's id/type, you already know
    enough to write out clicks/types/uploads for the *entire* form (text fields, file upload,
    every dropdown) as a single `browser_batch` — don't split into "name/email/phone", then a
    separate call for "resume", then another for "dropdowns" unless a step's outcome actually
    changes what the next step needs to do (e.g. an async-search combobox whose options only exist
    after you've typed a query). File upload, clicks and JS calls can all be items in the same
    `browser_batch` array alongside `computer`/`navigate`. Owner feedback 25 Sep 2026: still too
    chunky even after adopting `browser_batch` — "why don't you do everything, all the fields in
    one shot... same for uploading CV, everything async, in parallel, as much as possible."
  - **Default to one JS call for every plain text field and static-option dropdown; never use
    pixel-coordinate `computer` clicks on a react-select field.** Once the field-mapping pass has
    every id, write one `javascript_tool` call that loops over ALL of them — native-setter text
    fills plus `selectReactOption()` fiber writes for every dropdown with a fixed option list — and
    execute it as a single call. Mixing in `computer` clicks for some dropdowns is what causes the
    real slowdown: selecting one option can reflow the page, making the next pixel coordinate stale
    and forcing a re-screenshot-and-retry loop (observed 25 Sep 2026 on a Canonical form's Education
    section). JS calls read the DOM fresh every time, so they never go stale from a reflow — that's
    the reason to prefer them over clicking, not just speed.
  - **The only genuine two-step case is an async-search combobox** (its own `loadOptions` fetches
    matches from a remote API only after a query is typed — Greenhouse's School/Degree/Discipline
    fields, Ashby/Greenhouse city-search fields). You cannot know the exact option label before
    triggering that search, so it truly needs one round trip: type the query via `computer`, read
    the resulting options via JS, then pick. Everything else — every field with a fixed, already-
    known option list, and every plain input — has no such dependency and belongs in the single
    upfront JS batch.

## Before you start (session/tooling gotchas, 25 Sep 2026)
- **This skill is project-scoped to sre-watch.** If the session started in a different working
  directory, the `Skill` tool's registry does not pick it up even after `cd`-ing into
  `/Users/mac/sre-watch` mid-session (observed: two failed `Skill("apply-to-job")` calls in a row).
  Don't retry the `Skill` tool after a `cd` — go straight to `Read` on
  `/Users/mac/sre-watch/.claude/skills/apply-to-job/SKILL.md` and follow it as plain instructions.
- **Kit lookup: skip the schema fetch.** The Applications data source URL
  (`collection://346d7756-bafc-4dff-881f-2710819d90da`) and the `Job URL` column name are already
  known (see Inputs below) — go straight to a `notion-query-data-sources` SQL query
  (`WHERE "Job URL" LIKE '%<id>%'`) instead of fetching the database schema first. The `rows`/filter
  mode has a stricter input shape that's easy to get wrong on the first try; SQL mode with a `LIKE`
  is more forgiving and gets the row url in one call.
- **The auto-mark-applied polling step (Steps §9) can get blocked.** A `ScheduleWakeup` whose
  eventual action is `gh workflow run ... -f action=applied` was rejected by the permission
  classifier as an "External System Writes" risk in at least one session, even though the skill
  frames it as owner-pre-authorized. Don't spend a retry rediscovering this each time: if the
  schedule call is denied, skip straight to telling the owner the manual `gh workflow run` command
  to run themselves after they click Submit — same as the existing Fallback bullet.

## Inputs
| What | Where |
|---|---|
| Kit (cover letter, answers per form field, checks) | Notion Applications row for the job → toggle "📝 Application kit" → JSON code block. Find the row by querying the Applications database (`f56b68942d3b43cbb85a7b1ebfe2df1b`, data source `collection://346d7756-bafc-4dff-881f-2710819d90da`) for the job URL — SQL mode, not schema-fetch-then-rows mode (see gotchas above). |
| No kit yet | `gh workflow run daily.yml -R GarryOne/job-pilotto -f mode=prepare -f job=<job URL or 8-hex code>`; wait ~1 min (`gh run watch`). Or the 📝 Prepare button in Telegram. |
| Standard answers | Notion page Application Answers `3e562be8fd868108ae38d1f47d52a811` |
| Profile | Notion page `3e562be8fd8681579078d09829921b8c` |
| CV (upload + contact details) | `/Users/mac/Documents/CV.pdf` |

## Steps
1. **Kit.** Get the kit JSON. If the kit's `check_before_sending` has blockers (location
   restriction, required language, sponsorship for UK/Dubai), show them to the owner and ask
   whether to continue before opening the form.
2. **Open the form** in a new Chrome tab (claude-in-chrome). Greenhouse: the form is on the job
   page (`job-boards.greenhouse.io/<board>/jobs/<id>`), below the description.
3. **Map fields in one JS pass**: list `form input, textarea` with `id`, `type`, `role`,
   `aria-required` and label text. Match kit answers by `field` (= element id; strip `[]`).
4. **Fill text fields in one JS pass** (native setter so React sees it):
   `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true}))`
   (use `HTMLTextAreaElement.prototype` for textareas). First/last name, email, phone from the CV.
5. **Dropdowns** (see platform notes and Fast path below): try a framework-internals write first;
   if the framework doesn't expose one, open with a *real* click, then pick the option by JS.
   Verify `aria-expanded === 'true'` before picking — a click can land on the wrong control or can
   close a still-open previous dropdown instead of opening the new one; if so, click again.
6. **Files**: CV with the `file_upload` tool on `input#resume`. Cover letter: a text box
   (`Enter manually` → `#cover_letter_text`) gets the kit's `cover_letter`; a file-only field gets
   the letter as a PDF or .txt made in the scratchpad.
7. **Verify**: one JS pass listing every required field that is still empty or invalid, plus a
   screenshot of the form end. Fix what can be fixed. Reusable snippet (works for both plain inputs
   and react-select comboboxes; checks the displayed value, not `.value`, which react-select
   clears):
   ```js
   function unfilledRequiredFields(form) {
     const empty = [];
     form.querySelectorAll('[required], [aria-required="true"]').forEach(el => {
       const isCombo = el.getAttribute('role') === 'combobox';
       const filled = isCombo
         ? !!el.closest('[class*=select__container]')?.querySelector('[class*=single-value]')
         : el.type === 'file' ? el.files.length > 0 : (el.value || '').trim() !== '';
       if (!filled) empty.push(el.id || el.name || el.outerHTML.slice(0, 60));
     });
     return empty;
   }
   ```
   An empty result doesn't guarantee *correct* answers — it only rules out the most common failure
   mode (a field silently never got filled). Still read the screenshot before handing over.
8. **Hand over**: tell the owner in chat: filled fields (count), ❓ items left empty, kit checks,
   "Review and click Submit". Leave the tab open.
   - **Grow coverage**: every kit is drafted fresh from the Profile and Application Answers pages
     each time (`kit.py` reads both live, no caching) — so a ❓ or a `check_before_sending` item
     that's a **stable, non-job-specific fact** (education, permit, standard demographic answers,
     years/companies worked, salary target, notice period) is worth asking the owner to confirm
     once and saving straight to Profile or Application Answers. Once saved, every future kit
     already has it and it stops showing up as ❓. Leave genuinely **job-specific** items
     (this company's travel requirement, this role's on-call expectation) per-job — those aren't a
     coverage gap, they're correct per-job judgment calls.
9. **Auto-detect submission and mark applied — no owner action needed, if the tab is still open in
   this session.** Adopted 25 Sep 2026 after the owner asked to automate this step. Right after
   hand-over, note the tab's current URL (the job/application page) and use `ScheduleWakeup` to
   check back every 120–300s (long enough to not spam wakeups, short enough that "applied" lands in
   Notion soon after the owner actually submits):
   - On each wake, call `tabs_context_mcp` for that tab and compare its URL/title to the noted one.
   - Greenhouse navigates to a `.../confirmation` URL (or the page title/body changes to a
     "Thank you for applying" / "Your application has been submitted" state) once Submit succeeds —
     treat either signal as submitted. A `computer` screenshot is a fine confirmation before acting
     if the URL alone is ambiguous.
   - The moment submission is detected: run
     `gh workflow run daily.yml -R GarryOne/job-pilotto -f mode=apply -f job=<job URL> -f action=applied`
     immediately, without asking — the owner already authorized this by asking for the automation,
     and the underlying hard rule ("never click Submit") isn't touched; this only reacts *after* a
     human click. Then stop rescheduling for this job and tell the owner it's marked.
   - If nothing changes after a reasonable bound (e.g. ~2 hours / a handful of wakeups), stop
     polling silently — the owner may still be reviewing, may submit later, or may have closed the
     tab — and fall back to the manual path below. Never poll indefinitely.
   - **Fallback (tab closed, session ended, or detection never fired)**: the owner runs
     `gh workflow run daily.yml -R GarryOne/job-pilotto -f mode=apply -f job=<job URL> -f action=applied`
     themselves, or taps ✅ in Telegram.
   - This only works while this session and tab are alive — it is not a persistent background
     watcher across sessions. A fully unattended version would need the Cloudflare Worker or a
     GitHub Action polling Greenhouse instead; not built, since the owner is normally present to
     review and click Submit anyway.
   Then add anything new to **Platform notes** / **Log** below and commit.

## Full automatic flow (25 Sep 2026)

**Observable Terminal Codex option (25 Sep 2026):** `tools/apply-batch-codex-terminal.sh`
starts `src/ai/apply_run.py`, which captures the Codex JSONL trace and a structured final
field/attachment report in a private local directory outside the repo. It records Next step in
Notion and, only for a review-ready report, active Form fill time (min). Check
`python3 -m src.ai.apply_run --status` for failed or stale runs before retrying. The report is
agent-observed evidence, not an independent browser audit or a code-level Submit lock. Never put
the private trace, applicant values, or screenshots into this skill or git.

1. **Crawl/score** — already automatic, every 4h.
2. **Auto-draft kits** — `src/ai/kit.py:auto_run`, wired into `daily.py` for `scheduled`/`run`/`today`
   modes when the repository variable `SRE_WATCH_AUTO_KIT_MAX` is set (score ≥
   `SRE_WATCH_AUTO_KIT_MIN_SCORE`, default 50; capped per run). No manual 📝 Prepare tap needed for
   jobs that qualify; a short Telegram message lists what was drafted. Idempotent — table
   `auto_kits` in the canonical DB remembers which jobs already got one, so it never re-drafts.
   Manual 📝 Prepare still works for anything below the threshold or that needs a fresh draft.
3. **Queue kits into an AI browser agent** — `tools/apply-batch-chatgpt.sh` (wraps
   `python -m src.ai.apply_batch`): reads every job **Saved** with a kit in Notion Applications,
   builds a plain-text prompt from it, and pastes+sends it into a new ChatGPT/Codex desktop chat
   via `tools/send-to-chatgpt.sh`, one chat per job. Codex fills the form and stops before Submit
   on its own approval gate. Right after queueing a job, it moves that row's Stage from **Saved**
   to **Applying** in Notion — so a second run (or the next auto-kit cycle) never queues the same
   job into a second chat. If a paste-only chat is abandoned without sending, reset that job's
   Stage back to Saved in Notion to make it eligible again. It also prints each job's
   `check_before_sending` list as it queues (and again in a consolidated summary at the end), so
   the owner doesn't have to open Notion to remember what to double-check per job.
4. **Owner reviews and clicks Submit** — the one step that stays manual, on purpose, in every chat
   it queued.
5. **Mark applied** — `gh workflow run daily.yml -f mode=apply -f job=<job URL> -f action=applied`
   (or ✅ in Telegram) once submitted.

So the owner's only required actions are: watch each queued chat, click Submit, mark applied.
Everything before that (discovery, scoring, drafting, opening the chat, typing into it) runs
without a manual trigger. `tools/apply-batch-chatgpt.sh` still needs a person present per chat, same as
claude-in-chrome — see "Other tools tried" below for why that step can't be made fully unattended.

## Fast path: write the framework's state directly, skip clicking

Before falling back to click-then-pick on any dropdown, date picker or multi-step widget, check
whether it's cheaper to write straight into the UI framework's own state, bypassing the DOM event
dance entirely. Idea taken from the open-source agent skill
[Li7777777/job-application-autofill](https://github.com/Li7777777/job-application-autofill), which
does this for several Chinese ATS platforms (mokahr, 北森, ...) by reading the field component's
`memoizedProps` off its React fiber (`_get_()`/`_set_()`/`options` living right on the props) and
calling the setter directly — one call writes the value through the same code path a real click
would, no menu, no portal, no animation to wait for.

- **How to find the fiber key**: `Object.keys(el).find(k => k.startsWith('__reactFiber') ||
  k.startsWith('__reactProps') || k.startsWith('__reactInternalInstance'))` — the exact prefix
  depends on the React version the site ships.
- **Confirmed working for Greenhouse's react-select (25 Sep 2026, live on a real Canonical form,
  two different dropdown fields — no click, no menu, works cold from page load):** reading
  `__reactProps` directly off the `input[role=combobox]` or its `.select__control` wrapper gives
  the *wrong* handler — an `onMouseDown`/`onFocus`/native `onChange(e)` that expects a real DOM
  event (`e.target.value`) and throws if called with an option object. The **real** react-select
  `onChange(option, actionMeta)` lives ~16 levels up the **fiber `.return` chain** (React's own
  parent-in-tree pointer — not `el.parentElement`, which walks the DOM and misses it). Find it by
  arity, not depth (depth varies by site): walk `.return` collecting every `memoizedProps` that has
  both `onChange` (a function with `.length >= 2` — the giveaway that it takes `(option,
  actionMeta)`, not a lone DOM event) and an `options` array. Reusable snippet:
  ```js
  function selectReactOption(inputEl, matchLabel) {
    const fiberKey = Object.keys(inputEl).find(k => k.startsWith('__reactFiber'));
    let node = inputEl[fiberKey];
    for (let i = 0; i < 25 && node; i++, node = node.return) {
      const p = node.memoizedProps;
      if (p && typeof p.onChange === 'function' && Array.isArray(p.options) && p.onChange.length >= 2) {
        const option = p.options.find(o => o.label === matchLabel);
        if (!option) return {ok: false, why: 'no such option', options: p.options.map(o => o.label)};
        p.onChange(option, {action: 'select-option'});
        return {ok: true};
      }
    }
    return {ok: false, why: 'no select onChange found'};
  }
  ```
  This makes every Greenhouse dropdown a one-call, click-free operation — use it as the *first*
  attempt on any Greenhouse form's react-select fields, before falling back to the click-then-pick
  method in Platform notes below.
- Whether or not the direct write works, always verify by reading the value back from the DOM
  (`[class*=single-value]`, not `.value` — react-select clears its search input after a pick).
- This is worth 30 seconds of trying per new platform; fall back to real-click-then-JS-pick the
  moment it doesn't pan out. Record which one worked in Platform notes below.

## Platform notes (update after every application)
### Greenhouse (job-boards.greenhouse.io) — verified 25 Sep 2026 on Grafana Labs, full fill
- Text inputs: ids `first_name`, `last_name`, `preferred_name`, `email`, `phone`,
  `question_<n>`; native setter + `input` event works. Fill all of them in one JS pass.
- Dropdowns are react-select: `input#question_<n>[role=combobox]` inside `.select__container`.
  **Use the Fast path's `selectReactOption()` first** (confirmed working, zero clicks) — reading
  React props off the input or `.select__control` directly gives the wrong handler (a native
  `onChange(e)`, not react-select's `onChange(option, actionMeta)`); the real one is ~16 levels up
  the fiber `.return` chain, found by arity. Fallback if that ever fails on a given field: a real
  click on `.select__control` opens the menu; options are `#react-select-question_<n>-option-<i>`
  and a JS `click()` on the right option selects it (verified repeatedly). Selected value shows in
  `[class*=single-value]`
  (`.value` on the input itself stays empty — it's just react-select's search box).
- **Clicking straight from one open dropdown into the next field's control can close the first one
  without opening the second** (observed twice) — verify `aria-expanded` after clicking and click
  again if it's still `false`.
- **The resume/CV file input is a plain hidden `<input type="file">`**: use the `file_upload` tool
  with its element ref (from `read_page`/`find`), never click the visible "Attach" button — that
  opens a native OS file picker the tools can't see into.
- **`id="country"` next to the Phone field is the phone country-code selector, not a mailing/work
  country field** — its option list is dial codes (`"Switzerland +41"`, `"Romania +40"`, ...), not
  country names. Match it against the candidate's phone number's country, not their work-location
  country (a separate `question_<n>` field usually asks "In which country do you currently work?"
  explicitly — fill that one with the work country instead). Confirmed by a wrong first guess
  (25 Sep 2026, Canonical form) that dumped 150+ dial-code options into context before catching it.
- **Verifying the resume/CV upload: don't re-query `input#resume.files`.** Greenhouse swaps the file
  input's surrounding DOM out after a successful attach (the element may no longer be found the same
  way), so a post-upload `.files.length` check can wrongly read as empty/not-found. Confirm instead
  by reading the attached filename text that appears in the Resume/CV section (or a screenshot) —
  both reliably show the uploaded filename. Observed 25 Sep 2026 on a Canonical form.
- `candidate-location` (the required "Location (City)" field) is an async city-search combobox,
  separate from the phone `country` selector right above it — easy to click the wrong one when the
  page has scrolled between screenshots; always re-screenshot or re-`find` immediately before this
  click. Type the city, wait ~1s for suggestions, click the top match.
- Scroll the control into view with a real scroll before clicking; `scrollIntoView` from JS did
  not move the page in the tool's tab.
- Demographic (EEOC) and "which of the following best describes you" (bot-check: "I am a human
  being" vs "I am an AI or automated program") questions are dropdowns too; answer from
  Application Answers / the kit (default for the bot-check: human, since the applicant is human
  and reviews/submits personally).
- Invisible reCAPTCHA badge on the page: submission by a bot would be scored; another reason the
  owner submits.
### Ashby (jobs.ashbyhq.com/<board>/<id>/application) — verified 25 Sep 2026 on DeepL, no fiber trick needed
- The listing/board API (`api.ashbyhq.com/posting-api/job-board/<slug>`) does **not** expose
  application questions — only posting content. The real form only exists on the live
  `/application` page. Fine for filling live; it just means the kit can't pre-draft Ashby answers
  from an API the way it can for Greenhouse, only from likely-question guesses.
- Plain `<input>`/`<textarea>` with native `<label for>` — `el.labels[0].textContent` gives the
  real question text directly, no DOM archaeology needed. Native setter + `input` event fills them.
- Selection questions are **native checkboxes and radios**, not a custom widget — a plain `.click()`
  works, verified (`checkbox.checked` flips and persists). No react-select, no fiber walk required
  despite the page being React — Ashby renders real native form controls.
- System fields: `#_systemfield_name`, `#_systemfield_email`, resume via `input[type=file]`
  (`#_systemfield_resume`), a phone field, and one `[role=combobox]` text input for
  location/company autocomplete (type + wait + pick, same pattern as Greenhouse's `candidate-location`).
- Overall: **simpler to fill than Greenhouse** once you're on the live page.
### Lever (jobs.lever.co/<board>/<id>/apply) — verified 25 Sep 2026 on Palantir, not a React app at all
- Confirmed `!Object.keys(el).find(k=>k.startsWith('__react'))` — Lever's form has zero React
  involvement. Plain `.value` assignment + `input`/`change` events works on every text field, no
  special technique needed anywhere.
- Named fields, not id'd: use `input[name="org"]` etc., not `#org` — `name="name"`, `name="email"`,
  `name="phone"`, `name="org"` (current company), `name="urls[LinkedIn]"` / `urls[GitHub]` /
  `urls[Portfolio]`.
- `#location-input` is a Google-Places-style autocomplete with a paired hidden
  `#selected-location`; typing into it didn't surface a `.suggestions` list the way tested — needs
  another look before relying on it; a plain typed value may or may not satisfy the paired hidden
  field on its own.
- Checkboxes (e.g. language/skill tags as `cards[<uuid>][field<n>]`) are plain native checkboxes,
  `.click()` works, verified.
- Resume: `#resume-upload-input`, a plain file input — same `file_upload` tool approach as Greenhouse.
### Workable, Personio, SmartRecruiters
- Not yet seen. Record ids, widget types and what worked the first time.
### Workday, SuccessFactors, Taleo
- Account per employer, multi-page. Owner logs in; fill page by page from the kit; never create
  accounts.

## Efficiency
- Batch: one JS call to map, one to fill text, try the fast path for each dropdown, then
  click/pick pairs for whatever it couldn't handle, one JS call to verify.
- **Screenshot scale danger (caused a real misclick 25 Sep 2026):** a screenshot taken at
  `scale < 1` returns an image whose pixels are NOT the coordinate frame the `computer` tool
  clicks in — the tool result states the full-resolution frame size, but it's easy to eyeball a
  position on the smaller image and pass those smaller numbers straight through, landing ~1/scale
  off target. Either take screenshots at `scale: 1` when you're about to click from them, or
  multiply the coordinate by `1/scale` before clicking. Prefer clicking by element `ref` (from
  `find`/`read_page`) over pixel coordinates when the page hasn't scrolled since the ref was taken;
  refs go stale after a scroll or re-render, so re-`find` after either.
- Don't re-read the kit or Notion pages already read in this session.
- For a form with no reusable ATS pattern (a one-off Google Form, a random careers page), plain
  click-and-type is fine — don't spend time hunting for a fast path that will never be reused.

## Other tools tried (25 Sep 2026) — none replace this skill, keep for context

Compared claude-in-chrome against three alternatives on real forms, no submission:
- **ChatGPT Atlas** — discontinued by OpenAI; its own shutdown screen points to a Chrome
  extension or the ChatGPT desktop app instead.
- **Perplexity Comet, signed out** — could not act on the page at all ("I'm unable to interact
  with the browser page"); its agentic "Computer" feature is paywalled behind Perplexity Pro.
  Not tested with Pro.
- **ChatGPT/Codex desktop app** (`tools/send-to-chatgpt.sh` pastes a prompt into it, since there's
  no API/MCP access to read its results back — only the owner can watch and report) — genuinely
  filled real fields on the harder Canonical form (contact details, résumé, LinkedIn, long
  free-text SRE/infra answers), took ~10 minutes, and deliberately left personal/subjective/legal
  fields (academic history, travel commitment, employer count, the privacy-acknowledgment
  checkbox) for the owner even when the prompt supplied answers — the stricter rule now adopted
  above. Not wired into the Job Pilotto pipeline (no Notion/Telegram/GitHub Actions trigger); the
  owner drives it by hand.

None of the three beat this skill on "actually fills the form, stays inside the pipeline, review
gate enforced in code rather than by the model's own judgment call." Re-test before switching.

## Log (newest first; one line per application or finding)
- 2026-09-25 · Ashby + Lever, first look · tested live on real forms (DeepL "Head of Product
  Growth", Palantir "Backend Software Engineer") — no login, no submission, nothing sent. Neither
  needs Greenhouse's fiber trick: Ashby renders native checkboxes/radios with real `<label for>`
  text despite being React; Lever isn't React at all, plain `.value` assignment works everywhere.
  Both simpler to fill than Greenhouse once on the live page; neither platform's public listing API
  exposes application questions (only Greenhouse does), so kits for these still rely on likely-
  question guesses, not real ones. See Platform notes above.
- 2026-09-25 · Greenhouse fast path confirmed · validated live on a real Canonical application form
  (two react-select fields, gender and a Yes/No question): the fiber `.return`-chain walk finds
  react-select's real `onChange(option, actionMeta)` by arity (`.length >= 2`) and calling it
  directly sets the value with zero clicks, works cold, no menu ever opens. Promoted from
  "untested" to the default first attempt for Greenhouse dropdowns — see Fast path above.
- 2026-09-25 · Tools · compared against Atlas (discontinued), Comet (needs Pro, couldn't act
  signed out) and the Codex desktop app (worked, slower, stricter on legal fields) — see "Other
  tools tried" above. Added `tools/send-to-chatgpt.sh` to paste prompts into the desktop app.
- 2026-09-25 · Skill · pulled in a fast-path idea (write framework state directly, skip clicking)
  and a leak-guard rule from the open-source skill Li7777777/job-application-autofill; fixed a
  screenshot-scale bug that caused a real misclick during today's fill (see Efficiency).
- 2026-09-25 · Greenhouse · Grafana Labs Staff Databases SRE · form fully filled (all fields,
  CV uploaded, all 4 dropdowns), verified field-by-field, left open for the owner; nothing
  submitted. One misclick along the way (screenshot-scale bug, see above), caught and corrected.
- 2026-09-25 · Greenhouse · Canonical Senior SRE · form filled from a session that started outside
  sre-watch (had to `cd` in and read SKILL.md as a plain file — the `Skill` tool never picked up the
  project-scoped skill after `cd`, see "Before you start" above). Owner self-assessed dead time
  afterward and asked for fixes: added the skip-schema-fetch SQL shortcut for kit lookup, the
  phone-country-code-vs-work-country field disambiguation, and the resume-upload verification note
  (all folded into Platform notes / Before-you-start above). Also hit a permission-classifier denial
  on the Steps §9 auto-mark-applied `ScheduleWakeup` ("External System Writes") — noted as a known
  gotcha instead of a thing to rediscover each time.

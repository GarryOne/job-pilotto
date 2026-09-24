---
name: apply-to-job
description: Fill a job application form for the owner from their SRE Watch application kit, live in Chrome, stopping before Submit. Use when the owner says "apply to <job/URL>", "fill this application", "help me apply", or pastes a job/application link. Also use to record what was learned about an application form or platform.
---

# Apply to a job (SRE Watch)

Goal: the owner's application form, fully and correctly filled from the application kit, in their
own Chrome, **stopped before Submit**. The owner reviews and clicks Submit. Then the job is marked
applied. Speed matters: a Greenhouse form should take under 3 minutes.

## Hard rules
- **Never click Submit / Apply / Send.** Stop, show the summary, let the owner click. (Decision Log:
  never auto-apply. Changes only if the owner supersedes that decision there.)
- Only facts from the kit, the Notion Profile, Application Answers and the CV. Never invent.
- Anything marked ❓ in the kit, or a field with no source: leave it empty, list it for the owner.
- Never fill passwords or create accounts (Workday, SuccessFactors, Taleo ask for one): stop and
  hand over to the owner.
- CAPTCHA or "verify you are human": the owner solves it. Never try to bypass it.
- Contact details (email, phone, address) come from the CV PDF at apply time. Do not store them
  in Notion, the repo or memory.
- **Leak guard.** This file, Platform notes and the Log are committed to a public-ish git history.
  Never write a real name, email, phone, address, salary figure or answer text into them — use
  `<placeholder>` the way this file already does. Findings about a *site* (field ids, widget
  behaviour, error text) are fine; findings about *this application* (what was typed) are not.

## Inputs
| What | Where |
|---|---|
| Kit (cover letter, answers per form field, checks) | Notion Applications row for the job → toggle "📝 Application kit" → JSON code block. Find the row by querying the Applications database (`f56b68942d3b43cbb85a7b1ebfe2df1b`) for the job URL. |
| No kit yet | `gh workflow run daily.yml -R GarryOne/sre-watch -f mode=prepare -f job=<job URL or 8-hex code>`; wait ~1 min (`gh run watch`). Or the 📝 Prepare button in Telegram. |
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
   screenshot of the form end. Fix what can be fixed.
8. **Hand over**: tell the owner in chat: filled fields (count), ❓ items left empty, kit checks,
   "Review and click Submit". Leave the tab open.
9. **After the owner confirms submission**: `gh workflow run daily.yml -R GarryOne/sre-watch -f mode=apply -f job=<job URL> -f action=applied`
   (or ✅ in Telegram). Then add anything new to **Platform notes** / **Log** below and commit.

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
- **Where it failed for Greenhouse's react-select** (tried 25 Sep 2026): reading `__reactProps`
  off the `input[role=combobox]` or its `.select__control` wrapper gave an `onMouseDown`/`onFocus`
  that didn't open the menu when invoked directly. That's very likely the wrong node — react-select's
  own `onChange` lives on the top-level `<Select>` component instance, higher up the fiber tree, not
  on the DOM node the input renders into. **Untested next step**: walk up `el.parentElement` chain
  reading the fiber at each level until one's `memoizedProps` has an `onChange` whose signature
  looks like `(option, actionMeta) => ...` plus an `options` array matching what's on screen; call
  `onChange({value, label}, {action: 'select-option'})` directly. If this works it removes the
  click entirely and the "menu didn't open" class of bug disappears.
- Whether or not the direct write works, always verify by reading the value back from the DOM
  (`[class*=single-value]`, not `.value` — react-select clears its search input after a pick).
- This is worth 30 seconds of trying per new platform; fall back to real-click-then-JS-pick the
  moment it doesn't pan out. Record which one worked in Platform notes below.

## Platform notes (update after every application)
### Greenhouse (job-boards.greenhouse.io) — verified 25 Sep 2026 on Grafana Labs, full fill
- Text inputs: ids `first_name`, `last_name`, `preferred_name`, `email`, `phone`,
  `question_<n>`; native setter + `input` event works. Fill all of them in one JS pass.
- Dropdowns are react-select: `input#question_<n>[role=combobox]` inside `.select__container`,
  clickable `.select__control`. **Synthetic JS events do not open them** (mousedown, ArrowDown,
  typing, calling React props on the input or its `.control` wrapper all failed — that's likely
  the wrong fiber node; see Fast path above for the untested fix). A real click on `.select__control`
  opens it; then options are `#react-select-question_<n>-option-<i>` and a JS `click()` on the right
  option selects it (verified repeatedly). Selected value shows in `[class*=single-value]`
  (`.value` on the input itself stays empty — it's just react-select's search box).
- **Clicking straight from one open dropdown into the next field's control can close the first one
  without opening the second** (observed twice) — verify `aria-expanded` after clicking and click
  again if it's still `false`.
- **The resume/CV file input is a plain hidden `<input type="file">`**: use the `file_upload` tool
  with its element ref (from `read_page`/`find`), never click the visible "Attach" button — that
  opens a native OS file picker the tools can't see into.
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
### Lever, Ashby, Workable, Personio, SmartRecruiters
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

## Log (newest first; one line per application or finding)
- 2026-09-25 · Skill · pulled in a fast-path idea (write framework state directly, skip clicking)
  and a leak-guard rule from the open-source skill Li7777777/job-application-autofill; fixed a
  screenshot-scale bug that caused a real misclick during today's fill (see Efficiency).
- 2026-09-25 · Greenhouse · Grafana Labs Staff Databases SRE · form fully filled (all fields,
  CV uploaded, all 4 dropdowns), verified field-by-field, left open for the owner; nothing
  submitted. One misclick along the way (screenshot-scale bug, see above), caught and corrected.

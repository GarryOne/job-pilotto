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
5. **Dropdowns** (see platform notes): open each with a *real* click, then pick the option by JS.
   Batch: click → pick → next.
6. **Files**: CV with the `file_upload` tool on `input#resume`. Cover letter: a text box
   (`Enter manually` → `#cover_letter_text`) gets the kit's `cover_letter`; a file-only field gets
   the letter as a PDF or .txt made in the scratchpad.
7. **Verify**: one JS pass listing every required field that is still empty or invalid, plus a
   screenshot of the form end. Fix what can be fixed.
8. **Hand over**: tell the owner in chat: filled fields (count), ❓ items left empty, kit checks,
   "Review and click Submit". Leave the tab open.
9. **After the owner confirms submission**: `gh workflow run daily.yml -R GarryOne/sre-watch -f mode=apply -f job=<job URL> -f action=applied`
   (or ✅ in Telegram). Then add anything new to **Platform notes** / **Log** below and commit.

## Platform notes (update after every application)
### Greenhouse (job-boards.greenhouse.io) — verified 25 Sep 2026 on Grafana Labs
- Text inputs: ids `first_name`, `last_name`, `preferred_name`, `email`, `phone`,
  `question_<n>`; native setter + `input` event works.
- Dropdowns are react-select: `input#question_<n>[role=combobox]` inside `.select__container`,
  clickable `.select__control`. **Synthetic JS events do not open them** (mousedown, ArrowDown,
  typing, calling React props all failed). A real click on `.select__control` opens it; then
  options are `#react-select-question_<n>-option-<i>` and a JS `click()` on the right option
  selects it (verified). Selected value shows in `[class*=single-value]`.
- Scroll the control into view with a real scroll before clicking; `scrollIntoView` from JS did
  not move the page in the tool's tab.
- Other comboboxes: `country` (phone country), `candidate-location` (async city search: type the
  city, wait, pick the first option). The phone widget keeps a hidden list of `[role=option]`
  countries in the DOM: always select options by the field's own id prefix, never globally.
- Demographic (EEOC) questions are dropdowns too; answer from Application Answers (default:
  decline).
- Invisible reCAPTCHA badge on the page: submission by a bot would be scored; another reason the
  owner submits.
### Lever, Ashby, Workable, Personio, SmartRecruiters
- Not yet seen. Record ids, widget types and what worked the first time.
### Workday, SuccessFactors, Taleo
- Account per employer, multi-page. Owner logs in; fill page by page from the kit; never create
  accounts.

## Efficiency
- Batch: one JS call to map, one to fill text, then click/pick pairs for dropdowns, one to verify.
- Screenshots at 0.5 scale unless reading small text.
- Don't re-read the kit or Notion pages already read in this session.

## Log (newest first; one line per application or finding)
- 2026-09-25 · Greenhouse · Grafana Labs Staff Databases SRE · form inspected only, nothing
  submitted · findings above (react-select needs a real click).

# Job Pilotto — Chrome extension

Fills a job application from the kit Job Pilotto drafted for it. **It never clicks Submit**: after
filling, the page shows *Unlock for my review*; you check every field, unlock, and submit yourself.

## What it does

1. On an application page, click the ✈️ icon.
2. **Fill this form** fills it the best way, like an Apply with Claude session: the job's drafted kit first,
   then Claude answers only the questions the kit doesn't cover (from your Notion Profile and Application
   Answers; about USD 0.03–0.06 when it's needed, nothing when the kit covers every question). It fills text
   fields, radio buttons, non-legal checkboxes and selects, attaches your CV, and shows what's left.
3. **Eligibility check:** without a kit, if the posting rules you out (location, work permit, language),
   nothing is filled; the popup says why and offers **Fill anyway**.
4. **Searchable dropdowns** (Greenhouse) only open for a real click, so they're highlighted with
   "Click to choose: …". Click one; the extension picks the answer in the menu your click opened.
5. **Which job next** is the desktop app's: the extension is about the form in front of you.
6. **Parallel filling from the desktop app:** **Apply to jobs… → In Chrome** opens N jobs as tabs
   (each link ends in `#jobpilotto-fill`); the background worker fills every such tab by itself as
   it loads, side by side, and each shows its own "still yours to do" panel. Needs the one-time
   permission on job sites.
8. After you submit, **I submitted it: mark Applied** updates Notion (Telegram confirms).
9. **The ring** (bottom right of every application form): how many required fields are still empty, green
   with ✓ *Ready* when none is. Click it for the list; click an item to go to that field. With the app open it
   keeps the app's session page in step: agreements you tick here are ticked off there, and the app's
   *Open the form to tick it* scrolls here to that field. Read only: it never types, ticks or clicks anything.

Multi-page forms: click Next on the page, then Fill again.

## Privacy

- Permissions: `activeTab`, `scripting`, `storage`. Nothing runs on a page until you open the popup
  there. It has access to job sites only (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, SuccessFactors, Personio, Teamtailor, Recruitee, softgarden, Umantis, Taleo, iCIMS and BambooHR), so it can fill a tab it opened itself.
- Sent to your Worker for AI answers: the form's questions and choices and the page's text. Your
  contact details and CV stay in the browser.
- Your contact details are stored in this browser only (`chrome.storage.local`).
- It talks to one server: your own Cloudflare Worker, with your extension token.

## Install (developer mode, 2 minutes)

1. Chrome → `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → choose this `extension/` folder.
3. Pin ✈️ Job Pilotto (puzzle-piece icon → pin).
4. Right-click the icon → **Options**: paste your Worker URL and extension token, fill your
   contact details, choose your CV file, **Save**.

The token is the Worker secret `EXTENSION_TOKEN`. Create one with
`openssl rand -hex 24`, store it (`security add-generic-password -a "$USER" -s job-pilotto.extension.token -w`)
and set it on the Worker (`cd worker && npx wrangler@4 secret put EXTENSION_TOKEN`).

## Development

- `page/browser-submit-guard.js` and `page/browser-form-fastpath.js` are copies of the originals in
  `tools/`; run `./sync.sh` after changing those (a Worker test fails while they differ).
- Worker endpoints: `worker/src/extension.js` (`GET /extension/kit?url=`, 
  `POST /extension/answer`, `POST /extension/applied`); secrets `EXTENSION_TOKEN`, `ANTHROPIC_API_KEY`.
- `flow.js` is one fill run (describe → answer → fill), shared by the popup and `background.js`.
- Tests: `cd worker && npm test`.

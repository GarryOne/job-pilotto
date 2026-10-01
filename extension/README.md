# Job Pilotto — Chrome extension

Fills a job application from the kit Job Pilotto drafted for it. **It never clicks Submit**: after
filling, the page shows *Unlock for my review*; you check every field, unlock, and submit yourself.

## What it does

Everything happens in **the panel**, bottom right of every application form (the toolbar icon only points to it).

- **Collapsed:** a pill with a progress ring: *3 left*, or a green *Ready to submit* when every required field is
  filled. Click it to open the panel.
- **Open:** the job (title, company, stage), what Claude is doing on it when an Apply with Claude session works on
  this form, the progress (*12 of 15 required fields filled*), **Fill this form**, what's **left for you** (click
  one: the page scrolls to it; ⚖️ marks agreements only you may tick), and **I submitted it**, **Open in
  Job Pilotto**.
- **Fill this form** fills it the best way, like an Apply with Claude session: the job's drafted kit first, then
  Claude answers only the questions the kit doesn't cover (about USD 0.03–0.06 when needed, nothing when the kit
  covers every question). Text fields, radios, non-legal checkboxes, selects, searchable dropdowns and your CV.
  Without a kit, a posting that rules you out isn't filled unless you choose **Fill anyway**.
- **App first:** the job, its session and the form's state are shared with the Job Pilotto app both ways. Ticks
  you make here are ticked off on the app's session page; its *Show it in the form* scrolls here. Without the app
  (not open, or your own Worker) the panel still shows what's left and fills through your connection.
- **Never submits:** the panel reads the form and scrolls to fields; filling goes through the extension's fill,
  which never clicks Submit. Which job to apply to next is the desktop app's.
- **Up to date by itself:** an older copy in Chrome reloads itself from the app's folder, and joins the forms
  already open without reloading them.

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

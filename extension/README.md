# Job Pilotto — Chrome extension

Fills a job application from the kit Job Pilotto drafted for it. **It never clicks Submit**: after
filling, the page shows *Unlock for my review*; you check every field, unlock, and submit yourself.

## What it does

1. On an application page, click the ✈️ icon. The popup finds the job in your Applications
   tracker (by URL, including Greenhouse/Lever/Ashby alternate links) and shows its kit.
2. **Fill form** types the kit's answers and your contact details, picks dropdown options, and lists
   what is still yours to do: upload the CV, dropdowns it couldn't pick, required fields without an
   answer, legal checkboxes.
3. **Copy cover letter** puts the kit's letter on the clipboard.
4. After you submit, **I submitted it: mark Applied** updates Notion through the daily workflow
   (Telegram confirms).

Kits only contain form answers for Greenhouse forms today; on Lever, Ashby and others it fills your
contact details and you paste the cover letter.

## Privacy

- Permissions: `activeTab`, `scripting`, `storage` only. Nothing runs on a page until you open the
  popup there, and it can't read other tabs or sites.
- Your contact details are stored in this browser only (`chrome.storage.local`).
- It talks to one server: your own Cloudflare Worker, with your extension token.

## Install (developer mode, 2 minutes)

1. Chrome → `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → choose this `extension/` folder.
3. Pin ✈️ Job Pilotto (puzzle-piece icon → pin).
4. Right-click the icon → **Options**: paste your Worker URL and extension token, fill your
   contact details, **Save**.

The token is the Worker secret `EXTENSION_TOKEN`. Create one with
`openssl rand -hex 24`, store it (`security add-generic-password -a "$USER" -s job-pilotto.extension.token -w`)
and set it on the Worker (`cd worker && npx wrangler@4 secret put EXTENSION_TOKEN`).

## Development

- `page/browser-submit-guard.js` and `page/browser-form-fastpath.js` are copies of the originals in
  `tools/`; run `./sync.sh` after changing those (a Worker test fails while they differ).
- Worker endpoints: `worker/src/extension.js` (`GET /extension/kit?url=`, `POST /extension/applied`).
- Tests: `cd worker && npm test`.

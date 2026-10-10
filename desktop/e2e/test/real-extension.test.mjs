/* global document, chrome */
// Validates the upload fix on the REAL extension in a real (headless) Chrome, on a REAL Coop (SuccessFactors) application form, isolated from the owner's
// app, profile, CV, Keychain and AI (lib/real-extension.mjs proves it). Opt-in, because it needs the live site: `npm run real-extension` (JP_LIVE=1).
// What it checks that the shape tests (upload-slot.test.mjs) cannot: the extension's own wiring (injection, permissions, the panel's Fill button) and that
// the report of each upload actually leaves the extension for the app.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const POSTING = 'https://jobs.coop.ch/Coop/job/Nyon-Assistante-Assistant-du-commerce-de-d%C3%A9tail-AFP-Vaud/1405093533/?locale=en_US';
// REAL_EXTENSION_DIR=<folder> runs the same checks on another build of the extension (a positive control: the build from before a fix must fail them).
const extensionDir = process.env.REAL_EXTENSION_DIR || undefined;
const skip = process.env.JP_LIVE ? false : 'opt-in: set JP_LIVE=1 (npm run real-extension); it needs the live Coop site';

async function openForm(page) {
  await page.goto(POSTING, {waitUntil: 'networkidle'});
  await page.getByRole('link', {name: /Apply|Postuler/i}).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('.attachmentField', {timeout: 20000});
}
// The site's own "uploaded" mark per slot (SuccessFactors toggles it when it accepted the file).
const uploaded = page => page.$$eval('[id$=_attachSuccess]', marks => marks.map(mark => !mark.classList.contains('displayNone')));
async function waitUntil(check, seconds = 60) {
  for (let i = 0; i < seconds; i++) { if (await check()) return true; await new Promise(resolve => setTimeout(resolve, 1000)); }
  return false;
}

test('the CV and the cover letter go into their own slots, the site accepts them, and both uploads are reported', {skip}, async () => {
  const app = await startRealExtension({extensionDir, cv: true, letter: true});
  try {
    await openForm(app.page);
    assert.deepEqual(await uploaded(app.page), [false, false]);
    assert.ok(await app.fillWithPanel(), 'the panel offers a Fill button');
    assert.ok(await waitUntil(async () => (await uploaded(app.page)).every(Boolean)), `both slots show uploaded: ${JSON.stringify(await uploaded(app.page))}`);
    const reports = () => app.controlReports().flatMap(report => report.items || []).filter(item => item.kind === 'upload');
    assert.ok(await waitUntil(async () => reports().length >= 2, 30), 'the extension reports the uploads once the fill is done');
    const reported = reports();
    assert.deepEqual(reported.map(item => item.ok), [true, true], 'each upload is reported with its fingerprint');
    assert.ok(reported.every(item => /^[a-z0-9]{6,16}$/.test(item.fp)));
    assert.equal(app.told('Upload your CV'), false);
    await app.assertIsolated();
  } finally { await app.close(); }
});

test('without a CV in the app nothing is attached, and the CV is listed as left to do', {skip}, async () => {
  const app = await startRealExtension({extensionDir, cv: false});
  try {
    await openForm(app.page);
    assert.ok(await app.fillWithPanel());
    assert.ok(await waitUntil(async () => app.told('Upload your CV'), 40), 'the extension tells the app the CV is left');
    assert.deepEqual(await uploaded(app.page), [false, false]);
    await app.assertIsolated();
  } finally { await app.close(); }
});

// 9 Oct 2026, a friend's Windows Chrome: the app opened a jobs.ch posting to apply and nothing happened. jobs.ch is not one of
// manifest.json's hiring systems and "Work on every job site" was off, so the tab got a silent '?' badge: no panel, no Allow, no
// log line. A fresh profile has no optional site permission, as a new install does. Nothing on the page is pressed.
const NOT_ALLOWED = 'https://www.jobs.ch/en/vacancies/detail/a601bb40-5e00-429b-abdf-a52760202eda/';
test('an apply tab on a site not allowed yet opens the Allow page and tells the app why it waits', {skip}, async () => {
  const run = await startRealExtension({extensionDir});
  try {
    const opened = run.context.waitForEvent('page', {predicate: page => /allow\.html$/.test(page.url()), timeout: 30000}).catch(() => null);
    await run.page.goto(`${NOT_ALLOWED}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const allow = await opened;
    assert.ok(allow, 'the extension opened its Allow page beside the tab');
    assert.ok(await waitUntil(() => run.told('waits for Allow'), 30), 'the app log hears that the tab waits for Allow, and on which host');
    assert.ok(run.told('www.jobs.ch'));
    assert.ok(await run.assertIsolated());
  } finally {
    await run.close();
  }
});

// 9 Oct 2026, Deloitte: the application page sat behind a cookie dialog and the extension never closed it (only the job-reading flow had a closer), and its "how
// will you give your CV" step (Upload CV / Copy and paste CV / Upload later) hid the file input when "Copy and paste CV" was pressed after "Upload CV".
// These two run on LOCAL fixtures served at the real host's address (context.route fulfils every request to it): the extension sees the real hostname and
// permissions, but nothing goes to the third party. The live page changed under the earlier version of these tests (10 Oct 2026: both failed on the real
// site, with the original code too), so the shape is pinned here and the real site stays out of the test. Nothing is typed or submitted.
const DELOITTE = 'https://apply.deloitte.ch/CHCareers/ApplicationMethods?tempJobid=19243';
const serve = (run, html) => run.context.route('https://apply.deloitte.ch/**', route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html}));
const COOKIE_DIALOG = `<div role="dialog" id="cookie-dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;border:1px solid #888;padding:12px">
  <p>We use cookies and similar tracking to improve your visit.</p>
  <button type="button" onclick="document.getElementById('cookie-dialog').remove()">Accept all cookies</button>
  <button type="button" id="reject" onclick="document.getElementById('cookie-dialog').remove()">Reject optional cookies</button></div>`;
// The choice step as the real page draws it: three ways to give the CV, each reveals its own part; the file input sits in a hidden container; pressing a way hides the others.
const CHOICE_STEP = `<body><h1>Choose from one of the options below to start your application</h1>
  <div class="how"><a role="button" onclick="show('fileBox')">Upload CV</a> <a role="button" onclick="show('pasteBox')">Copy and paste CV</a> <a role="button" onclick="show('')">Upload later</a></div>
  <fieldset id="fileBox" style="display:none"><label>Upload CV * <input type="file" id="resumeFile"></label></fieldset>
  <fieldset id="pasteBox" style="display:none"><label>Copy and paste CV * <textarea id="resumePaste" required></textarea></label></fieldset>
  <script>function show(id) { for (const box of ['fileBox', 'pasteBox']) document.getElementById(box).style.display = box === id ? 'block' : 'none'; }</script></body>`;

test('a cookie dialog over an application page is closed by the extension', {skip}, async () => {
  const run = await startRealExtension({extensionDir, allowAllSites: true});
  try {
    await serve(run, `<body><h1>Application</h1>${CHOICE_STEP.replace('<body>', '')}${COOKIE_DIALOG}`);
    await run.page.goto(`${DELOITTE}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const dialog = run.page.locator('#cookie-dialog');
    await dialog.waitFor({timeout: 30000});
    assert.ok(await waitUntil(async () => !(await dialog.isVisible().catch(() => false)), 60), 'the cookie dialog is gone');
    assert.ok(await waitUntil(() => run.told('closed a popup'), 20), 'the app log says it');
    assert.ok(await run.assertIsolated());
  } finally { await run.close(); }
});

// The page-kind AI's word is stubbed as the real log has it (posting, button "upload cv"). The fake CV goes into a local page, nothing else is typed, never Submit.
// What this proves: the real extension presses "Upload CV" on a posting-kind page and attaches the CV into the hidden input. What it does NOT prove: that the "paste way is not pressed"
// guard (page/upload.js `given`) works, since the test still passes with that guard removed (mutation control, 10 Oct 2026); upload-slot.test.mjs's choice shape is the guard's test.
test('a choice step that reveals its own file input: the CV is attached, the paste way is not pressed', {skip}, async () => {
  const run = await startRealExtension({extensionDir, cv: true, allowAllSites: true, answer: {'/extension/page-kind': () => ({ok: true, kind: 'posting', role: 'no-form', by: 'ai', confidence: 0.98, applyButton: 'upload cv'})}});
  try {
    await serve(run, CHOICE_STEP);
    await run.page.goto(`${DELOITTE}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const attached = () => run.page.evaluate(() => document.getElementById('resumeFile')?.files.length || 0).catch(() => 0);
    assert.ok(await waitUntil(async () => (await attached()) === 1, 60), 'the CV is in the page\'s file input');
    assert.equal(await run.page.evaluate(() => !!document.getElementById('resumePaste')?.getClientRects().length), false, 'the paste box was not opened');
    assert.ok(await run.assertIsolated());
  } finally { await run.close(); }
});

// 10 Oct 2026: after a refresh nothing started and there was no button. The toolbar popup's "Apply on this page" (message applyHere) fills again on a tab the app opened, never on another page;
// a real reload does the same. WHAT THIS PROVES: the wiring (the message is accepted, the fill runs, a reload refills, a page the app did not open is refused). WHAT IT DOES NOT: that the
// popup's press needs forgetApplyTries (messages-panel.js): this fixture shows its file input at once, so the build without that call also passes (control run, 10 Oct 2026). The case that needs it
// is a fresh document with the input hidden after an Apply press was tried: on the real Deloitte page the press failed without the call and filled with it; worker/test/visit-consent.test.js guards the call.
test('Apply on this page refills a tab the app opened, a reload refills, any other page is refused', {skip}, async () => {
  const run = await startRealExtension({extensionDir, cv: true, allowAllSites: true, answer: {'/extension/page-kind': () => ({ok: true, kind: 'posting', role: 'no-form', by: 'ai', confidence: 0.98, applyButton: 'upload cv'})}});
  try {
    await serve(run, CHOICE_STEP);
    // The popup's page is opened first, before any tab is armed: a tab created right after an Apply press is taken for "the tab Apply opened" and the posting tab is closed (tabs.js followOpener).
    const popup = await run.context.newPage();
    await popup.goto(`chrome-extension://${new URL(run.context.serviceWorkers()[0].url()).host}/popup.html`);
    await run.page.bringToFront();
    const attached = () => run.page.evaluate(() => document.getElementById('resumeFile')?.files.length || 0).catch(() => -1);
    const ask = (address) => popup.evaluate(async url => { const [tab] = await chrome.tabs.query({url}); return chrome.runtime.sendMessage({type: 'applyHere', tabId: tab.id}); }, address);
    await run.page.goto(`${DELOITTE}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    assert.ok(await waitUntil(async () => (await attached()) === 1, 60), 'the first fill attaches the CV');
    await run.page.evaluate(() => { document.getElementById('resumeFile').value = ''; });   // the person emptied it (or the page lost it): nothing is attached any more
    assert.equal(await attached(), 0, 'the input is empty');
    assert.equal((await ask('https://apply.deloitte.ch/*'))?.ok, true, 'accepted on the tab the app opened');
    assert.ok(await waitUntil(async () => (await attached()) === 1, 60), 'the page is filled again');
    await run.page.reload({waitUntil: 'domcontentloaded'});
    assert.ok(await waitUntil(async () => (await attached()) === 1, 60), 'a real reload fills it again');
    const other = await popup.evaluate(async () => { const tab = await chrome.tabs.create({url: 'https://example.com/'}); await new Promise(resolve => setTimeout(resolve, 1500)); return chrome.runtime.sendMessage({type: 'applyHere', tabId: tab.id}); });
    assert.equal(other?.ok, false, 'a page the app did not open is refused');
    assert.ok(await run.assertIsolated());
  } finally { await run.close(); }
});

/* global document */
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

// 9 Oct 2026: Deloitte's application page sat behind a cookie dialog and the extension never closed it (only the job-reading flow had a closer). Any
// popup over a page the extension works on is closed the same way (extension/consent.js); here a real cookie dialog, closed by the free word rule
// (the harness has no AI). Nothing on the page is typed or submitted.
const COOKIE_PAGE = 'https://apply.deloitte.ch/CHCareers/ApplicationMethods?tempJobid=19243';
test('a cookie dialog over an application page is closed by the extension', {skip}, async () => {
  const run = await startRealExtension({extensionDir});
  try {
    await run.page.goto(`${COOKIE_PAGE}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const dialog = run.page.getByRole('button', {name: /optional cookies/i}).first();
    await dialog.waitFor({timeout: 30000});
    assert.ok(await waitUntil(async () => !(await dialog.isVisible().catch(() => false)), 60), 'the cookie dialog is gone');
    assert.ok(await waitUntil(() => run.told('closed a popup'), 20), 'the app log says it');
    assert.ok(await run.assertIsolated());
  } finally { await run.close(); }
});

// 9 Oct 2026, Deloitte's "how will you give your CV" step (Upload CV / Copy and paste CV / Upload later): the input is hidden until "Upload CV", the operator
// waited for a NEW input, and "Copy and paste CV" (also an upload trigger) was pressed after, hiding it. The page-kind AI's word is stubbed as the real log has it
// (posting, button "upload cv"). The fake CV goes to a real third-party page (fixture, not the owner's), nothing else is typed, never Submit.
test('a choice step that reveals its own file input: the CV is attached, the paste way is not pressed', {skip}, async () => {
  const run = await startRealExtension({extensionDir, cv: true, answer: {'/extension/page-kind': () => ({ok: true, kind: 'posting', role: 'no-form', by: 'ai', confidence: 0.98, applyButton: 'upload cv'})}});
  try {
    await run.page.goto(`${COOKIE_PAGE}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const attached = () => run.page.evaluate(() => document.getElementById('resumeFile')?.files.length || 0).catch(() => 0);
    assert.ok(await waitUntil(async () => (await attached()) === 1, 60), 'the CV is in the page\'s file input');
    assert.equal(await run.page.evaluate(() => !!document.getElementById('resumePaste')?.getClientRects().length), false, 'the paste box was not opened');
    assert.ok(await run.assertIsolated());
  } finally { await run.close(); }
});

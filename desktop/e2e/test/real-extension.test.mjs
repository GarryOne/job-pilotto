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

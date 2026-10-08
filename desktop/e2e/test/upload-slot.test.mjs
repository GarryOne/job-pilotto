/* global window, document */
// Upload slots that only create their file input when "+" is clicked (SuccessFactors, e.g. Coop: "Upload a CV" / "Add a document"):
// the extension must open the CV slot, attach the CV, leave the cover-letter slot alone, and flag a missing CV as an open required row.
// Runs on a fixture built like the real widget (a real Chrome, no network). JP_LIVE=1 also runs the same checks on the real Coop form.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

const PAGE_FILES = ['browser-submit-guard', 'browser-form-fastpath', 'snapshot', 'skeleton', 'controls', 'coverage', 'propose', 'upload', 'fill'];
const CV = {data: fs.readFileSync(new URL('../fixtures/cv.pdf', import.meta.url)).toString('base64'), name: 'cv.pdf', type: 'application/pdf'};

// Two slots like the real ones: a label with a star, a box, a + button. A click on + opens a popup holding the one file input.
const SLOT = (id, label) => `<div class="col"><div class="lab">${label}</div><div class="attachWrapper"><div class="attachmentLabel"><span>${label.replace(/^\* /, '').split(' and ')[0].replace(/,.*/, '') === 'Cover letter' ? 'Add a document' : 'Upload a CV'}</span></div>
<span role="button" tabindex="0" class="addAttachments" id="${id}" onclick="openPopup('${id}')">+</span><div class="ok" hidden></div></div></div>`;
const FIXTURE = `<body><h1>Application</h1>
${SLOT('cvPlus', '* CV and diplomas/school transcripts')}${SLOT('docPlus', 'Cover letter, certificates, diplomas, etc.')}
<label>Email: * <input id="email" type="email" required></label>
<div id="popup" hidden>Select a source for your file <button type="button" id="fromDevice">From device</button></div>
<script>
  window.attached = {};
  function openPopup(id) {
    const popup = document.getElementById('popup');
    popup.hidden = false;
    popup.querySelector('input')?.remove();
    const input = document.createElement('input');
    input.type = 'file'; input.name = 'fileData' + id;
    input.addEventListener('change', () => {
      window.attached[id] = input.files[0]?.name;
      document.getElementById(id).parentElement.querySelector('.ok').hidden = false;
    });
    popup.appendChild(input);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('popup').hidden = true; });
</script></body>`;

const run = async (page, resume) => {
  for (const file of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/page/${file}.js`, import.meta.url), 'utf8')});
  return page.evaluate(async cv => {
    const row = () => window.__jobPilottoAuditVisibleFields().find(r => r.field === 'resume');
    const before = row();
    const result = await window.__jobPilottoExtensionFill([], {}, cv);
    return {before, after: row(), resumeAttached: result.resumeAttached, todo: result.todo};
  }, resume);
};

const withPage = async (url, fn, html = null) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({locale: 'en-US'});
    if (html) await page.setContent(html); else await url(page);
    await fn(page);
  } finally { await browser.close(); }
};

test('the CV goes into the CV slot that opens its file input on click, and not into the other document slot', async () => {
  await withPage(null, async page => {
    const out = await run(page, CV);
    assert.equal(out.before.required, true, 'the CV slot is a required row before the fill');
    assert.equal(out.before.filled, false);
    assert.equal(out.resumeAttached, true);
    const attached = await page.evaluate(() => window.attached);
    assert.deepEqual(attached, {cvPlus: 'cv.pdf'});
  }, FIXTURE);
});

test('without a CV in the app, the empty required CV slot is listed as something to do', async () => {
  await withPage(null, async page => {
    const out = await run(page, null);
    assert.equal(out.resumeAttached, false);
    assert.equal(out.after.filled, false);
    assert.ok(out.todo.includes('Upload your CV'), `todo: ${out.todo}`);
    assert.deepEqual(await page.evaluate(() => window.attached), {});
  }, FIXTURE);
});

test('a plain file input still takes the CV as before', async () => {
  await withPage(null, async page => {
    const out = await run(page, CV);
    assert.equal(out.resumeAttached, true);
    assert.equal(await page.evaluate(() => document.querySelector('input[type=file]').files[0]?.name), 'cv.pdf');
  }, '<body><h2>Resume/CV *</h2><input type="file" id="resume"></body>');
});

test('the real Coop form takes the CV (JP_LIVE=1)', {skip: !process.env.JP_LIVE}, async () => {
  await withPage(async page => {
    await page.goto('https://jobs.coop.ch/Coop/job/Nyon-Assistante-Assistant-du-commerce-de-d%C3%A9tail-AFP-Vaud/1405093533/?locale=en_US', {waitUntil: 'networkidle'});
    await page.getByRole('link', {name: /Apply|Postuler/i}).first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  }, async page => {
    const out = await run(page, CV);
    assert.equal(out.before.filled, false);
    assert.equal(out.resumeAttached, true);
    assert.equal(out.after.filled, true);
    const shown = await page.$$eval('[id$=_attachSuccess]', els => els.filter(el => !el.classList.contains('displayNone')).length);
    assert.equal(shown, 1, 'the site itself shows the CV slot as uploaded');
  });
});

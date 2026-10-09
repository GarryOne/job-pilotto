/* global window, document */
// A field asked for by its label from the app ("Use" on a Needs your attention row: extension/page/propose.js __jobPilottoFillOne) is found whether the page puts
// the required star before the label or after it (owner, 9 Oct 2026: SuccessFactors writes "* Titre de civilité"; the app asked for "Titre de civilité", the field
// was never found, so the menu choice the AI picked by meaning was never put in). The SHAPE, not a site: stars on either side, a text box and a menu. A real Chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

const PAGE_FILES = ['browser-submit-guard', 'browser-form-fastpath', 'snapshot', 'skeleton', 'controls', 'coverage', 'propose', 'upload', 'radios', 'menu-pick', 'fill-labels', 'fill-read', 'fill-menus', 'fill-checks', 'fill-marks', 'fill'];
const FORM = `<body><form>
  <div><label for="first">* Prénom</label><input id="first" required></div>
  <div><label for="last">Nom *</label><input id="last" required></div>
  <div><label for="title">* Titre de civilité</label><select id="title" required><option value="">Aucune sélection</option><option>M.</option><option>Mme</option></select></div>
</form></body>`;

test('a field asked for by its label is found with the required star before or after it', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({locale: 'fr-CH'});
    await page.setContent(FORM);
    for (const name of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/page/${name}.js`, import.meta.url), 'utf8')});
    const one = (label, value) => page.evaluate(([l, v]) => window.__jobPilottoFillOne(l, v), [label, value]);
    const leading = await one('Prénom', 'Ada'), trailing = await one('Nom', 'Tester'), menu = await one('Titre de civilité', 'M.');
    const values = await page.evaluate(() => ({first: document.getElementById('first').value, last: document.getElementById('last').value, title: document.getElementById('title').selectedOptions[0]?.text}));
    assert.equal(leading.ok, true, 'the leading-star text box was not found by its label');
    assert.equal(trailing.ok, true, 'the trailing-star text box was not found by its label');
    assert.equal(menu.ok, true, 'the leading-star menu was not found by its label');
    assert.deepEqual(values, {first: 'Ada', last: 'Tester', title: 'M.'});
  } finally { await browser.close(); }
});

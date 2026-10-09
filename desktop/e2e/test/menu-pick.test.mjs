/* global window, document */
// A menu answer is only "picked" when the page shows it (owner, 9 Oct 2026, Migros on SuccessFactors: the picker clicked the option by script, the widget ignored it,
// and "a menu picked for you, matched" was logged over an empty field). The SHAPES: a menu that takes only a real click on its option (picked through the trusted
// fallback that flow.js clickCombos makes with Chrome's debugger: here Playwright's mouse, also trusted), a plain menu (picked by script), a menu that never selects
// (not called picked: still armed, left to you). What was seen (opened, found, selectedAfter, trusted) is recorded for the fill card. A real Chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

const PAGE_FILES = ['browser-submit-guard', 'browser-form-fastpath', 'snapshot', 'skeleton', 'controls', 'coverage', 'propose', 'upload', 'radios', 'menu-pick', 'fill-labels', 'fill-read', 'fill-menus', 'fill-checks', 'fill-marks', 'fill'];
// A combobox input that opens a list on mousedown; `accept` decides which option clicks select: 'trusted' (SuccessFactors-like), 'any', or 'none'.
const MENU = accept => `<body><form><div class="field"><label for="pays">* Pays de résidence</label>
  <input id="pays" role="combobox" aria-expanded="false" readonly value="Aucune sélection" style="width:240px">
  <ul id="list" role="listbox" hidden style="list-style:none;padding:0;margin:0;width:240px">${['Aucune sélection', 'Suisse', 'Allemagne', 'France'].map(o => `<li role="option" style="padding:6px">${o}</li>`).join('')}</ul></div></form>
  <script>
    const input = document.getElementById('pays'), list = document.getElementById('list');
    input.addEventListener('mousedown', () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); });
    for (const li of list.children) li.addEventListener('click', event => {
      if ('${accept}' === 'none' || ('${accept}' === 'trusted' && !event.isTrusted)) return;
      input.value = li.textContent; li.setAttribute('aria-selected', 'true'); list.hidden = true; input.setAttribute('aria-expanded', 'false');
    });
  </script></body>`;

// The fill arms the menu with the answer; then what flow.js clickCombos does, with trusted mouse clicks: click the armed menu, and click the option's spot if the page leaves one.
async function pick(accept) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(MENU(accept));
    for (const name of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/page/${name}.js`, import.meta.url), 'utf8')});
    await page.evaluate(() => window.__jobPilottoExtensionFill([{field: 'pays', value: 'Suisse'}], {}, null, '', false));
    const armedBefore = await page.evaluate(() => window.__jobPilottoArmedCount());
    const spot = await page.evaluate(() => window.__jobPilottoNextCombo(0));
    await page.mouse.click(spot.x, spot.y);
    let clickedSpot = false;
    for (let waited = 0; waited < 6000; waited += 100) {
      await page.waitForTimeout(100);
      if (await page.evaluate(() => window.__jobPilottoArmedCount()) < armedBefore) break;
      const at = clickedSpot ? null : await page.evaluate(() => window.__jobPilottoPickSpot || null);
      if (at) { clickedSpot = true; await page.mouse.click(at.x, at.y); }
    }
    await page.waitForTimeout(300);
    return await page.evaluate(() => ({value: document.getElementById('pays').value, armed: window.__jobPilottoArmedCount(), last: window.__jobPilottoLastPick, badge: document.querySelector('.job-pilotto-badge')?.textContent || ''}));
  } finally { await browser.close(); }
}

test('a menu that takes only a real click on its option is picked through the trusted fallback, and says so', async () => {
  const out = await pick('trusted');
  assert.equal(out.value, 'Suisse');
  assert.equal(out.armed, 0, 'still armed: the selection was not seen');
  assert.deepEqual({opened: out.last.opened, found: out.last.found, selectedAfter: out.last.selectedAfter, trusted: out.last.trusted}, {opened: true, found: true, selectedAfter: true, trusted: true});
});

test('a plain menu is picked by script, no trusted click needed', async () => {
  const out = await pick('any');
  assert.equal(out.value, 'Suisse');
  assert.equal(out.armed, 0);
  assert.equal(out.last.trusted, false);
  assert.equal(out.last.selectedAfter, true);
});

test('a menu that never selects is NOT called picked: still armed, left to you, and the miss is observed as not selected', async () => {
  const out = await pick('none');
  assert.notEqual(out.value, 'Suisse');
  assert.equal(out.armed, 1, 'a menu that did not select was reported picked (the 9 Oct "matched" over an empty field)');
  assert.match(out.badge, /pick it yourself/);
  assert.deepEqual({found: out.last.found, selectedAfter: out.last.selectedAfter}, {found: true, selectedAfter: false});
});

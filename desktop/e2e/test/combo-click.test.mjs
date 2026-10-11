/* global window, document */
// A menu whose choices draw late (a click-only react-select that renders its options 2.5 s after the click, and closes on a second click) is picked by
// ONE click and a wait for the page's own decision (extension/combo-click.js), never a second click that shuts it (Ocado, 11 Oct 2026: right to work,
// "no option matched" on one run and "menu did not open" on the next). The real combo-click.js over a real Chrome, Playwright's mouse as the trusted click.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {PAGE_FILES} from '../../../extension/page-files.js';
import {clickCombo} from '../../../extension/combo-click.js';

const MENU = delay => `<body><form><label for="rtw">* Do you have the right to work here?</label>
  <input id="rtw" role="combobox" aria-expanded="false" style="width:240px"><div id="menu" hidden>
  </div><script>
    window.clicks = 0;
    const input = document.getElementById('rtw'), menu = document.getElementById('menu');
    input.addEventListener('mousedown', () => {
      window.clicks++;
      if (!menu.hidden) { menu.hidden = true; menu.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); return; }   // a second click shuts it
      menu.hidden = false; input.setAttribute('aria-expanded', 'true');
      setTimeout(() => { if (menu.hidden) return; menu.innerHTML = ['Yes', 'No, I require a visa'].map(o => '<div role="option" class="select__option">' + o + '</div>').join('');
        for (const o of menu.children) o.addEventListener('click', () => { input.value = o.textContent; menu.hidden = true; input.setAttribute('aria-expanded', 'false'); }); }, ${delay});
    });
  </script></form></body>`;

async function run(delay) {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.setContent(MENU(delay));
    for (const file of PAGE_FILES) await p.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    await p.evaluate(() => window.__jobPilottoExtensionFill([{field: 'rtw', value: 'Yes'}], {}, null, '', false));
    const page = (func, args = []) => p.evaluate(({f, a}) => new Function(`return (${f})`)()(...a), {f: func.toString(), a: args});
    const click = (x, y) => p.mouse.click(x, y);
    const spot = await page(n => window.__jobPilottoNextCombo(n), [0]);
    const result = await clickCombo({page, click, spot, skip: 0});
    return {...result, value: await p.evaluate(() => document.getElementById('rtw').value), clicks: await p.evaluate(() => window.clicks)};
  } finally { await browser.close(); }
}

test('a menu whose choices draw 2.5 s after the click is picked by one click', async () => {
  const out = await run(2500);
  assert.equal(out.value, 'Yes');
  assert.equal(out.picked, true);
  assert.equal(out.clicks, 1, 'a second click shut the menu');
});

test('a menu with no choice that matches says what it saw, after the page is done', async () => {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.setContent(MENU(300).replace("'Yes', 'No, I require a visa'", "'Maybe', 'Perhaps'"));
    for (const file of PAGE_FILES) await p.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    await p.evaluate(() => window.__jobPilottoExtensionFill([{field: 'rtw', value: 'Yes'}], {}, null, '', false));
    const page = (func, args = []) => p.evaluate(({f, a}) => new Function(`return (${f})`)()(...a), {f: func.toString(), a: args});
    const spot = await page(n => window.__jobPilottoNextCombo(n), [0]);
    const {picked, last} = await clickCombo({page, click: (x, y) => p.mouse.click(x, y), spot, skip: 0});
    assert.equal(picked, false);
    assert.deepEqual({opened: last?.opened, found: last?.found, choices: last?.choices}, {opened: true, found: false, choices: ['Maybe', 'Perhaps']});
  } finally { await browser.close(); }
});

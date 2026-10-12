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

// A type-to-search box (a search-as-you-type combobox whose options come from a server after the typing, drawn in a layer of their own, and which ignores
// scripted input events): the answer is typed for real, a shorter start when the whole finds nothing, and when the text differs the AI picks by meaning
// from the options shown (pick-choice). Two pages with one shape and different markup; both must pick.
const TYPEAHEAD = {
  // A: label before an input, options as <li role=option> in a layer at the end of <body>, English.
  plain: {place: 'Location', cities: ['Geneva, Switzerland', 'Genoa, Italy'], markup: `<label for="loc">Location *</label> <input id="loc" role="combobox" aria-expanded="false" autocomplete="off">`},
  // B: another id, the box wrapped, label after it, German wording, options as <li class="item-x"> in a listbox, in a layer.
  other: {place: 'Ort', cities: ['Genf, Schweiz', 'Genua, Italien'], markup: `<div class="wrap"><div class="inner"><input id="ort-9" role="combobox" aria-label="Ort" aria-expanded="false" autocomplete="off"></div></div><span>Ort *</span>`},
};
const typeaheadPage = ({markup, cities}, variant) => `<body><form>${markup}<script>
  const input = document.querySelector('input'); const layer = document.createElement('div'); layer.hidden = true; document.body.appendChild(layer);
  const norm = text => text.toLowerCase();   // no accent folding: the server wants the start of a name as spelt
  const cities = ${JSON.stringify(cities)};
  window.searches = [];
  // only real typing counts: a scripted input event is ignored
  input.addEventListener('input', event => {
    if (!event.isTrusted) return;
    const query = input.value; window.searches.push(query);
    layer.hidden = false; layer.innerHTML = '';
    setTimeout(() => { if (input.value !== query) return;
      const hits = cities.filter(city => norm(city).startsWith(norm(query)));
      const items = hits.map(city => '<li ${variant === 'other' ? 'class="item-x"' : 'role="option"'}>' + city + '</li>').join('');
      layer.innerHTML = ${variant === 'other' ? `'<ul role="listbox">' + items + '</ul>'` : 'items'};
      for (const item of layer.querySelectorAll('li')) item.addEventListener('click', () => { input.value = item.textContent; layer.hidden = true; input.setAttribute('aria-expanded', 'false'); });
    }, 700);
  });
  input.addEventListener('mousedown', () => { layer.hidden = false; input.setAttribute('aria-expanded', 'true'); });
</script></form></body>`;

async function runTypeahead(kind, answer, chosen) {
  const config = TYPEAHEAD[kind];
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.setContent(typeaheadPage(config, kind));
    for (const file of PAGE_FILES) await p.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    const id = kind === 'plain' ? 'loc' : 'ort-9';
    await p.evaluate(({id, answer}) => window.__jobPilottoExtensionFill([{field: id, value: answer}], {}, null, '', false), {id, answer});
    const page = (func, args = []) => p.evaluate(({f, a}) => new Function(`return (${f})`)()(...a), {f: func.toString(), a: args});
    const asked = [];
    const type = async text => { await p.keyboard.press('ControlOrMeta+a'); await p.keyboard.insertText(text); };
    const choose = async request => { asked.push(request); return chosen(request.choices); };
    const spot = await page(n => window.__jobPilottoNextCombo(n), [0]);
    const result = await clickCombo({page, click: (x, y) => p.mouse.click(x, y), spot, skip: 0, type, choose});
    return {...result, value: await p.evaluate(id => document.getElementById(id).value, id), asked, searches: await p.evaluate(() => window.searches)};
  } finally { await browser.close(); }
}

for (const kind of ['plain', 'other']) {
  test(`type-to-search box (${kind}): typed for real, the text that differs is picked by meaning from its options`, async () => {
    const answer = kind === 'plain' ? 'Genève, Suisse' : 'Genève, Suisse';
    const out = await runTypeahead(kind, answer, options => options.find(o => /^gen[fe]/i.test(o)));
    assert.equal(out.picked, true, JSON.stringify(out.last));
    assert.match(out.value, /^Gen[fe]/);
    assert.ok(out.searches.some(text => text.length <= 4), 'a shorter start was typed when the whole found nothing: ' + out.searches);
    assert.equal(out.asked.length, 1);
    assert.ok(out.asked[0].choices.length >= 1);
  });
}

test('type-to-search box: the answer already among the options needs no AI', async () => {
  const out = await runTypeahead('plain', 'Geneva, Switzerland', () => { throw new Error('asked'); });
  assert.equal(out.picked, true, JSON.stringify({last: out.last, searches: out.searches, asked: out.asked}));
  assert.equal(out.value, 'Geneva, Switzerland');
  assert.equal(out.asked.length, 0);
});

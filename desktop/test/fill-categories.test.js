// The AI's reading of a question (kit.py / worker answer category) in page/fill.js: a consent in any language is never ticked by us, and
// the kind is marked on the field for the review panel (8 Oct 2026: "Li e aceito a política de privacidade" was not caught by LEGAL).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {fakeFillPage} from './fake-fill-page.js';

test('a consent the AI read as legal is never ticked, in any language; its kind is marked for the review panel', async () => {
  const rows = [{field: 'privacidade', label: 'Li e aceito a política de privacidade', type: 'checkbox', required: true, filled: false, legal: false},
    {field: 'visto', label: 'Precisa de visto para trabalhar em Portugal?', type: 'text', required: true, filled: false, legal: false}];
  const {elements, fill} = fakeFillPage(rows);
  await fill([{field: 'privacidade', value: 'checked', category: 'legal'}, {field: 'visto', value: 'Não', category: 'knockout'}]);
  assert.equal(elements.privacidade.clicks, 0, 'never ticked by us');
  assert.equal(elements.privacidade.dataset.jobpilottoCategory, 'legal');
  assert.equal(elements.visto.dataset.jobpilottoCategory, 'knockout');
});

test('a voluntary question the AI read as demographic is declined, in any language, like the English words', async () => {
  const fill = fs.readFileSync(new URL('../../extension/page/fill.js', import.meta.url), 'utf8');
  assert.match(fill, /!\(row\.demographic \|\| DEMOGRAPHIC\.test\(row\.label/);
  const categories = fs.readFileSync(new URL('../../extension/page/categories.js', import.meta.url), 'utf8');
  assert.match(categories, /if \(item\.category === 'demographic'\) row\.demographic = true;/);
});

test('every calling code names a country; the codes the filler named before keep their exact names', () => {
  const window = {};
  vm.runInContext(fs.readFileSync(new URL('../../extension/page/dial-codes.js', import.meta.url), 'utf8'), vm.createContext({window, Intl}));
  const dial = window.__jobPilottoDial;
  assert.ok(Object.keys(dial).length >= 200);
  for (const [code, country] of [['+852', 'Hong Kong'], ['+90', 'T'], ['+65', 'Singapore'], ['+7', 'Russia'], ['+27', 'South Africa'], ['+57', 'Colombia']]) {
    assert.ok(String(dial[code]).startsWith(country), `${code}: ${dial[code]}`);
  }
  const fill = fs.readFileSync(new URL('../../extension/page/fill-menus.js', import.meta.url), 'utf8');
  assert.match(fill, /const DIAL = \{\.\.\.\(window\.__jobPilottoDial \|\| \{\}\), '\+1': 'United States'/);   // the old names win (after the spread)
  assert.match(fill, /'\+420': 'Czech Republic'/);
});

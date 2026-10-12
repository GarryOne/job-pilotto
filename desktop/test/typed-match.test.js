// "Does the box still hold what we typed?" is one rule in two worlds: the fill's page script (tools/browser-form-fastpath.js typedSame, which also types a changed box again)
// and the panel's content script (extension/page/typed-check.js, which will not call a changed box filled). They must agree,
// (12 Oct 2026, Recruitee: a phone widget back on "+972" read as filled).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const load = (file, extra = {}) => {
  const window = {__jobPilottoDial: {'+41': 'Switzerland', '+972': 'Israel', '+1': 'United States'}, ...extra};
  const document = {querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {}};
  vm.runInNewContext(fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), {window, document, getComputedStyle: () => ({}), CSS: {escape: x => x}, Event: class {}, CustomEvent: class {}, Object, String, Array, Date, Math, RegExp, Map, Set, console});
  return window;
};
const page = load('extension/page/browser-form-fastpath.js'), panel = load('extension/page/typed-check.js');
const alnum = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const CASES = [   // [typed, now, same?]
  ['+41 79 555 01 23', '+41795550123', true], ['+41 79 555 01 23', '079 555 01 23', true], ['+41 79 555 01 23', '+972', false], ['+41 79 555 01 23', '', false],
  ['Ada Tester', 'ada tester', true], ['12.05.1990', '1990-05-12', true], ['ada@example.test', 'ada@example.test', true], ['ada@example.test', 'bob@example.test', false],
  ['https://www.linkedin.com/in/ada', 'linkedin.com/in/ada', true], ['Zürich', 'Zürich, Schweiz', true],
];
test('the page script and the panel agree on every case, and a box reset to the widget\'s own country code is not the number we typed', () => {
  for (const [typed, now, same] of CASES) {
    assert.equal(page.__jobPilottoTypedSame(typed, now), same, `page script: ${typed} -> ${now}`);
    assert.equal(panel.__jobPilottoTypedSame(alnum(typed).slice(0, 160), now), same, `panel: ${typed} -> ${now}`);
  }
});

test('a box holding only a calling code is empty for the panel and the readers; a number, a name or a bare plus-and-digits-and-more is not', () => {
  const given = panel.__jobPilottoBoxGiven;
  assert.deepEqual(['', ' ', '+972', '+1', '+41 '].map(given), [false, false, false, false, false]);
  assert.deepEqual(['+41 79 555 01 23', '+41795550123', 'Ada', '0795550123', '+49123456'].map(given), [true, true, true, true, true]);
  for (const file of ['extension/review.js', 'extension/page/fill-read.js', 'extension/page/coverage.js', 'extension/account-fill.js', 'tools/browser-form-fastpath.js']) {
    assert.match(fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), /__jobPilottoBoxGiven|\\\+\\d\{1,4\}/, `${file} treats a calling code alone as empty`);
  }
});

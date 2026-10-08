// The AI's reading of a question (kit.py / worker answer category) in page/fill.js: a consent in any language is never ticked by us, and
// the kind is marked on the field for the review panel (8 Oct 2026: "Li e aceito a política de privacidade" was not caught by LEGAL).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function page(rows) {
  const elements = Object.fromEntries(rows.map(row => [row.field, {id: row.field, type: row.type, checked: false, dataset: {}, clicks: 0,
    click() { this.clicks++; this.checked = !this.checked; }, getAttribute: () => null, closest: () => null, labels: [], value: ''}]));
  const window = {__jobPilottoGuardActive: true};
  const document = {getElementById: id => elements[id] || null, querySelector: () => null, querySelectorAll: () => [], body: {innerText: ''},
    documentElement: {className: ''}};
  const context = vm.createContext({window, document, getComputedStyle: () => ({}), setTimeout, clearTimeout, CSS: {escape: s => s}, console,
    Event: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}});
  for (const file of ['categories.js', 'fill.js']) vm.runInContext(fs.readFileSync(new URL(`../../extension/page/${file}`, import.meta.url), 'utf8'), context);
  window.__jobPilottoDescribeForm = async () => rows.map(row => ({...row}));
  window.__jobPilottoCheckboxQuestions = () => [];
  window.__jobPilottoFillKnownFields = () => ({filled: []});
  return {window, elements};
}

test('a consent the AI read as legal is never ticked, in any language; its kind is marked for the review panel', async () => {
  const rows = [{field: 'privacidade', label: 'Li e aceito a política de privacidade', type: 'checkbox', required: true, filled: false, legal: false},
    {field: 'visto', label: 'Precisa de visto para trabalhar em Portugal?', type: 'text', required: true, filled: false, legal: false}];
  const {window, elements} = page(rows);
  await window.__jobPilottoExtensionFill([{field: 'privacidade', value: 'checked', category: 'legal'},
    {field: 'visto', value: 'Não', category: 'knockout'}], {}, null).catch(() => null);
  assert.equal(elements.privacidade.clicks, 0, 'never ticked by us');
  assert.equal(elements.privacidade.dataset.jobpilottoCategory, 'legal');
  assert.equal(elements.visto.dataset.jobpilottoCategory, 'knockout');
});

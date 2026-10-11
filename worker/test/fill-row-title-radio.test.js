// A radio group laid out as a form row (cells or divs) is read by the row's question, not by its first option ("Frau"): a "*" sign in its own
// element must not become the title, and a plain title block with no label-like class is still the title (pool cause "unread", 11 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const opt = (id, name, text) => `<span><label for="${id}"><input id="${id}" name="${name}" type="radio"><span>${text}</span></label></span>`;
const LAYOUTS = {
  'a div row, the "*" in its own span': `<div class="form_content_row"><div class="form_content_left_boundary"><div class="form_content_left">Anrede<span class="form_content_label_mustsign">*</span>:</div></div><div class="form_content_right_boundary"><div class="form_content_right">${opt('a', 'g1', 'Frau')}${opt('b', 'g1', 'Herr')}</div></div></div>`,
  'a table row, plain first cell': `<table><tr class="r"><td>Anrede *</td><td>${opt('a', 'g1', 'Frau')}${opt('b', 'g1', 'Herr')}</td></tr></table>`,
  'a table row, the "*" cell first': `<table><tr><td><b>*</b></td><td>Anrede</td><td>${opt('a', 'g1', 'Frau')}${opt('b', 'g1', 'Herr')}</td></tr></table>`,
};

for (const [name, html] of Object.entries(LAYOUTS)) {
  test(`${name}: the radio group is named by its question`, { skip: !JSDOM }, async () => {
    const window = openPage(JSDOM, `<form>${html}</form>`);
    const rows = await window.__jobPilottoDescribeForm();
    const row = rows.find(r => r.type === 'radio');
    assert.equal(row.label, 'Anrede');
    assert.deepEqual([...row.options],['Frau', 'Herr']);
  });
}

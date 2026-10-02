// Fill-failure snapshots go to a PUBLIC GitHub issue: the Worker scrubs every report again before it is written.
// (The page-side capture and its personal-data checks are tested in the private extension repo.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOT_MAX, snapshotFromReport, snapshotHtml } from '../src/snapshot.js';
import { sanitize } from '../src/report.js';

test('the Worker scrubs every report again: an untrusted tree with scripts, handlers and personal data comes out clean', () => {
  const evil = { t: 'div', a: { onclick: 'x()', style: 'x', class: 'a b', 'data-token': 'sk_live_1', id: 'q<1>`' }, c: [
    { t: 'script', a: {}, c: ['alert(1)'] }, { t: 'img', a: { src: 'https://x' }, c: [] },
    { t: 'a', a: { href: 'javascript:alert(1)' }, c: ['mail ada.lovelace@example.com, call +41 79 123 45 67, see https://x.io/?t=1'] },
    '```\n<script>alert(1)</script>', { t: 'input', a: { type: 'hidden', value: 'csrf' }, c: [] },
    { t: 'input', a: { type: 'text', value: 'Ada', 'data-jp-field': '' }, c: [] },
    { t: 'textarea', a: {}, c: ['I love numbers'] }, { t: 'x-widget', a: { role: 'listbox' }, c: [{ t: 'option', a: { value: 'MSc' }, c: ['MSc'] }] },
    { t: 'IFRAME', a: {}, c: [] }, { t: '"><b', a: {}, c: [] }, 42, null] };
  const html = snapshotFromReport(evil);
  for (const leak of ['onclick', 'style', 'sk_live', '<script', 'src=', 'href', 'ada.lovelace', '79 123', 'x.io', '```', 'csrf',
    'value="Ada"', 'I love numbers', 'iframe', '"><b', '`']) assert.ok(!html.includes(leak), `"${leak}" in:\n${html}`);
  assert.match(html, /<x-widget role="listbox">/);
  assert.match(html, /<option value="MSc">MSc<\/option>/);
  assert.match(html, /&lt;script&gt;/);  // text is escaped, never markup
});

test('snapshots are capped at 8 KB: a long list keeps its first entries and the failing field', () => {
  const options = Array.from({ length: 400 }, (_, i) => ({ t: 'div', a: { role: 'option', class: 'select__option' }, c: [`Country number ${i}`] }));
  const tree = { t: 'div', a: {}, c: [{ t: 'label', a: { for: 'country' }, c: ['Country'] },
    { t: 'div', a: { role: 'listbox' }, c: [...options.slice(0, 350), { t: 'input', a: { id: 'country', role: 'combobox', 'data-jp-field': '' }, c: [] }, ...options.slice(350)] }] };
  const html = snapshotFromReport(tree);
  assert.ok(html.length <= SNAPSHOT_MAX && html.length > 1000);
  assert.match(html, /data-jp-truncated="\d+"/);
  assert.match(html, /id="country"[^>]*data-jp-field/);
  assert.match(html, /Country number 0</);
});

test('reports carry the scrubbed snapshot as HTML; a report without one is unchanged', () => {
  const report = { site: 'job-boards.greenhouse.io', version: '0.9.0', fields: [
    { label: 'Degree', type: 'combobox', reason: 'dropdown clicked, but no option matched',
      snapshot: { t: 'div', a: {}, c: [{ t: 'input', a: { id: 'degree', role: 'combobox', value: 'Ada', 'data-jp-field': '' }, c: [] }, 'ada.lovelace@example.com'] } },
    { label: 'Visa', type: 'combobox', reason: 'dropdown that opens only on a real click' }] };
  const clean = sanitize(report);
  assert.equal(clean.fields[0].snapshot, '<div>\n <input id="degree" role="combobox" data-jp-field>\n [email]\n</div>\n');
  assert.ok(!('snapshot' in clean.fields[1]));
});

// The Lab's Experiments tab (src/search-lab-experiments.js): every row of docs/lab/search-experiments.json has the fixed fields and a known outcome (a new field or outcome fails here), newest first, and the tab is in the page.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {FIELDS, OUTCOMES, experimentsSection} from '../src/search-lab-experiments.js';
import {page} from '../src/search-lab-page.js';

const rows = JSON.parse(readFileSync(new URL('../../docs/lab/search-experiments.json', import.meta.url), 'utf8'));

test('every experiment row has exactly the fixed fields and a known outcome', () => {
  assert.ok(rows.length >= 8, 'positive control: the rows are read');
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...FIELDS].sort(), row.what);
    assert.ok(row.outcome in OUTCOMES, `${row.what}: outcome "${row.outcome}" is one of ${Object.keys(OUTCOMES).join(', ')}`);
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('the section lists newest first, counts the outcomes, and escapes text', () => {
  const html = experimentsSection([{date: '2026-10-01', what: 'old <b>', metric: 'm', before: '1', after: '2', outcome: 'parked', link: '#1'}, {date: '2026-10-09', what: 'new', metric: 'm', before: '1', after: '3', outcome: 'shipped', link: '#2'}]);
  assert.ok(html.indexOf('new') < html.indexOf('old'));
  assert.match(html, /Measured changes<\/span><b>2<\/b>/);
  assert.ok(!html.includes('old <b>'), 'text is escaped');
  assert.match(experimentsSection([]), /No experiment recorded yet/);
});

test('the tab is in the page', () => {
  const html = page([], [], 'experiments', []);
  assert.match(html, /href="\?tab=experiments"[^>]*>Experiments/);
  assert.match(html, /What was tried, and what it moved/);
});

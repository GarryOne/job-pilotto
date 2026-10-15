// The "Reported by a person" tag on Lab Form Filling and the report counts on Real Form Filling (spec 2026-10-15-report-this-form.md §5): counts only, nothing when there are none or no table yet,
// and every row of a site (the pool table, Needs a fix) carries the tag.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {reportCounts, reportsSection} from '../src/report-counts.js';

const d1 = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0071_form_reports.sql', import.meta.url), 'utf8'));
  return {db, prepare: sql => ({all: async () => ({results: db.prepare(sql).all()})})};
};

test('counts by status, and a section only when something was received', async () => {
  const e = d1();
  assert.equal(reportsSection(await reportCounts(e)), '', 'nothing received: no section');
  for (const [id, status] of [['a', 'new'], ['b', 'new'], ['c', 'fetched'], ['d', 'fixed']]) e.db.prepare('INSERT INTO form_reports (id, day, who, bytes, requests, status) VALUES (?, ?, ?, 1, 1, ?)').run(id, '2026-10-15', 'w', status);
  const counts = await reportCounts(e);
  assert.deepEqual(counts, {received: 4, waiting: 2, fetched: 1, fixed: 1});
  const html = reportsSection(counts);
  assert.match(html, /Reported by a person/); assert.ok(!/https?:|install|who/i.test(html.replace(/<[^>]+>/g, ' ').replace(/Reported by a person/g, '')), 'no host or install in the section');
  assert.equal(await reportCounts({prepare: () => ({all: async () => { throw new Error('no such table'); }})}), null, 'a database without the table shows nothing');
});

test('every site row on Lab Form Filling carries the tag: the pool table and Needs a fix', () => {
  const source = readFileSync(new URL('../src/applying.js', import.meta.url), 'utf8');
  assert.match(source, /const reportedTag = s => \(\/\^reported-\/\.test\(s\.shape \|\| s\.name/);
  const rows = source.split('\n').filter(line => line.includes("className: 'sitename'") && line.includes('s.platform') || line.includes("className: 'sitecell'"));
  assert.ok(rows.length >= 2, 'the site rows were not found');
  for (const row of rows) assert.ok(row.includes('reportedTag(s)'), `a site row without the tag: ${row.slice(0, 80)}`);
});

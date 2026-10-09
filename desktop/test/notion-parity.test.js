// Parity guard (Notion optional, end of P8): every place the window opens Notion names the in-app view a person without Notion sees,
// or is marked pending with its lane. A new entry point without a row in notion-parity.js fails; the pending ones are printed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {notionEntryPoints, scanHtml, scanJs} from './notion-entry-scan.js';
import {NOTION_PARITY} from './notion-parity.js';

const renderer = file => new URL(`../renderer/${file}`, import.meta.url);

test('every Notion entry point in the window has an in-app view, a pending lane or a reason', () => {
  const found = notionEntryPoints();
  const missing = [...new Set(found.filter(entry => !NOTION_PARITY[entry.key]).map(entry => `${entry.key} (line ${found.find(e => e.key === entry.key).line})`))];
  assert.deepEqual(missing, [], `Notion entry points with no row in desktop/test/notion-parity.js (name the in-app view, or pending: <lane>):\n${missing.join('\n')}`);
  const keys = new Set(found.map(entry => entry.key));
  const stale = Object.keys(NOTION_PARITY).filter(key => !keys.has(key));
  assert.deepEqual(stale, [], `rows for entry points that are gone: remove them from notion-parity.js`);
  const pending = Object.entries(NOTION_PARITY).filter(([, row]) => row.pending);
  console.log(`Notion parity: ${keys.size} entry points, ${pending.length} pending:\n${pending.map(([key, row]) => `  ${key} -> ${row.pending}`).join('\n')}`);
});

test('every row is one kind, and each named view still exists', () => {
  for (const [key, row] of Object.entries(NOTION_PARITY)) {
    const kinds = ['view', 'pending', 'none'].filter(kind => typeof row[kind] === 'string' && row[kind].trim());
    assert.equal(kinds.length, 1, `${key}: exactly one of view / pending / none`);
    if (!row.view) continue;
    const [file, name] = row.view.split(' ');
    assert.ok(fs.existsSync(renderer(file)), `${key}: ${file} does not exist`);
    assert.match(fs.readFileSync(renderer(file), 'utf8'), new RegExp(`(function\\s+${name}\\b|\\b${name}\\s*=)`), `${key}: ${row.view} not found`);
  }
});

test('the scanner finds what opens Notion and skips wording and comments', () => {
  const js = [
    'function a() {', '  // window.pilot.openNotion(x) in a comment', "  toast('Saved in Notion');", '}',
    'export function b(job) {', '  window.pilot.openNotion(job.notion_url);', '}',
    'const c = () => ({label: \'Open kit in Notion\', run});',
    "function d(u) { window.pilot.openExternal(draft.pageUrl); }",
  ].join('\n');
  assert.deepEqual(scanJs('x.js', js).map(e => e.key), ['x.js b', 'x.js c', 'x.js d']);
  // A URL read into a value, opened a few lines later in the same function (the Calendar's dead click, 9 Oct 2026); a URL read in one
  // function and an open in the next is not one entry point.
  const indirect = ['function open(m) {', '  const url = m.job?.notion_url;', '  if (url) window.pilot.openExternal(url);', '}',
    'function other() { const page = run.notionUrl; }', 'function later() { window.pilot.openExternal(run.url); }'].join('\n');
  assert.deepEqual(scanJs('c.js', indirect).map(e => e.key), ['c.js open']);
  // A control drawn only when a Notion page exists: missing on a store without pages (Focus's "Review rejection", 9 Oct 2026).
  const gated = ['function renderInsight(insight) {', "  if (insight.notion_url) box.append(focusButton('Review rejection', 'secondary', run));", '}',
    'function m(job) {', "  if (job.notion_url) menu.push({label: 'Open', run});", '}', 'function v(x) {', "  const kept = x.notion_url && el('span', 'a', 'b');", '}',
    'function w(job) {', "  const tagged = job.notion_url ? 'Notion' : 'This Mac';", '}'].join('\n');
  assert.deepEqual(scanJs('g.js', gated).map(e => e.key), ['g.js renderInsight', 'g.js m', 'g.js v'], 'a gated control, not a mere mention');
  const html = '<p>Saved in Notion</p><button id="open-x" class="link">Open answers in Notion</button><a id="y">Elsewhere</a>';
  assert.deepEqual(scanHtml('i.html', html).map(e => e.key), ['i.html#open-x']);
});

// The job's drawer covers the page it was opened from, so going to another page in the menu closes it (owner, 12 Oct 2026: "yes, it should close").
// Checked in the source, since the window needs Electron; the real window is checked by the focus suite's Review step (e2e/suites/focus.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const nav = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');

test('openView closes the job drawer when the view really changes, before the new view is drawn', () => {
  assert.match(nav, /import \{[^}]*\bcloseJobPanel\b[^}]*\} from '\.\/job-panel\.js';/, 'nav.js imports closeJobPanel');
  const body = nav.slice(nav.indexOf('export function openView('));
  const close = body.indexOf('closeJobPanel()');
  assert.ok(close > 0, 'openView calls closeJobPanel()');
  assert.match(body.slice(Math.max(0, close - 60), close), /if \(leaving !== name\)/, 'only when the view changes (the gate\'s re-open of the same view keeps it)');
  assert.ok(close < body.indexOf("document.querySelectorAll('.view')"), 'closed before the views are shown');
});

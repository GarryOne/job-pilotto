// Chrome first, Claude the safety net (owner, 9 Oct 2026): no session card makes "Apply with Claude" its main (orange) button; where the
// extension is stuck, "Open in Chrome" is. "Resume Claude" on a session that already is Claude's is not this case.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('no card offers Apply with Claude as its primary action; a stuck card leads with Open in Chrome', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/sessions.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sessionButton\('Apply with Claude', 'primary'/);
  const stuck = source.slice(source.indexOf('if (stuck) {'), source.indexOf('const resume = kind =>'));
  assert.ok(stuck.indexOf("'Open in Chrome', 'primary'") >= 0 && stuck.indexOf("'Open in Chrome', 'primary'") < stuck.indexOf("'Apply with Claude', 'secondary'"));
});

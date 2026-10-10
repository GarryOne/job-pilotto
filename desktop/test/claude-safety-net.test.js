// Chrome first, Claude the safety net (owner, 9 Oct 2026): no session card makes "Apply with Claude" its main (orange) button; where the
// extension is stuck, "Open in Chrome" is. "Resume Claude" on a session that already is Claude's is not this case.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('no card offers Apply with Claude as its primary action; a stuck card leads with Open in Chrome', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/sessions.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sessionButton\('Apply with Claude', 'primary'/);
  const stuck = source.slice(source.indexOf('if (stuck) {'), source.indexOf('const resume = kind =>'));
  assert.ok(stuck.indexOf("'Open in Chrome', 'primary'") >= 0 && stuck.indexOf("'Open in Chrome', 'primary'") < stuck.indexOf('offerParts(item'));
  // The Claude offer on that card (renderer/claude-offer.js) has no orange button either: every Claude choice there is secondary or a link.
  assert.doesNotMatch(fs.readFileSync(new URL('../renderer/claude-offer.js', import.meta.url), 'utf8'), /button\('[^']*(?:Claude|Continue)[^']*', 'primary'/);
});

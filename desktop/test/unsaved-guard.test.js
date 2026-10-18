// Closing or reloading the window with unsaved edits asks first (lib/unsaved-guard.js; owner, 18 Oct 2026, UI redesign D2); a hidden test window never waits.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {guardUnsaved, UNSAVED_DIALOG} from '../lib/unsaved-guard.js';

function contents() {
  const handlers = {};
  return {on: (name, fn) => { handlers[name] = fn; }, fire: () => { let left = false; handlers['will-prevent-unload']({preventDefault: () => { left = true; }}); return left; }};
}

test('Stay keeps the window and its drafts; Leave without saving lets it close', () => {
  const stay = contents();
  guardUnsaved(stay, {ask: () => 0});
  assert.equal(stay.fire(), false);
  const go = contents();
  let asked = null;
  guardUnsaved(go, {ask: options => { asked = options; return 1; }});
  assert.equal(go.fire(), true);
  assert.deepEqual(asked.buttons, ['Stay', 'Leave without saving']);
  assert.equal(UNSAVED_DIALOG.cancelId, 0, 'Esc stays');
});

test('a hidden test window leaves without a dialog', () => {
  const hidden = contents();
  guardUnsaved(hidden, {ask: () => { throw new Error('no dialog in a hidden run'); }, hidden: true});
  assert.equal(hidden.fire(), true);
});

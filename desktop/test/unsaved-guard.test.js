// Closing or reloading the window with unsaved edits asks first (lib/unsaved-guard.js; owner, 18 Oct 2026, UI redesign D2); a hidden test window never waits;
// a quit that met the edits goes on after Leave (the app stayed with no window).
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

// A fake app: before-quit listeners and a quit counter (Electron cancels the quit when the page holds its unload).
function fakeApp() {
  const listeners = [];
  return {quits: 0, on: (name, fn) => listeners.push(fn), removeListener: () => {}, quit() { this.quits++; }, askQuit: () => listeners.forEach(fn => fn())};
}

test('a quit that met unsaved edits goes on after Leave without saving; Stay cancels it; closing the window alone never quits', () => {
  const now = fn => fn();
  const left = contents(), app = fakeApp();
  guardUnsaved(left, {ask: () => 1, app, later: now});
  app.askQuit();
  assert.equal(left.fire(), true);
  assert.equal(app.quits, 1, 'the cancelled quit is asked again, else the app stayed with no window');
  const stayed = contents(), app2 = fakeApp();
  guardUnsaved(stayed, {ask: () => 0, app: app2, later: now});
  app2.askQuit();
  assert.equal(stayed.fire(), false);
  assert.equal(app2.quits, 0);
  const closed = contents(), app3 = fakeApp();
  guardUnsaved(closed, {ask: () => 1, app: app3, later: now});
  assert.equal(closed.fire(), true);
  assert.equal(app3.quits, 0, 'closing the window is not quitting');
});

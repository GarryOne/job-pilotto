// The Applying page paints the last known sessions at once, then the app's own list replaces them. Before this it
// painted the empty two-pane shell (message box + session log) for seconds, or a false "no sessions yet" (1 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rememberSessions, rememberedSessions} from '../renderer/sessions-cache.js';

const fakeStorage = (initial = null) => {
  const store = new Map(initial === null ? [] : [['jp-sessions', initial]]);
  return {getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value), raw: store};
};

test('a remembered list comes back, and anything unreadable is no list at all', () => {
  const storage = fakeStorage();
  assert.deepEqual(rememberedSessions(storage), []);                       // nothing remembered yet
  const sessions = [{id: 'fa008153', company: 'Anthropic', status: 'done'}];
  rememberSessions(sessions, storage, new Date('2026-10-01T08:00:00Z'));
  assert.deepEqual(rememberedSessions(storage), sessions);
  assert.match(storage.raw.get('jp-sessions'), /"at":"2026-10-01T08:00:00.000Z"/);
  // A cache written by an older version, or by hand, is ignored rather than rendered.
  assert.deepEqual(rememberedSessions(fakeStorage('{"sessions": "nope"}')), []);
  assert.deepEqual(rememberedSessions(fakeStorage('not json')), []);
  assert.deepEqual(rememberedSessions({getItem: () => { throw new Error('no storage'); }}), []);
  // Storage that refuses to write (private mode, quota) must not break the page either.
  rememberSessions(sessions, {setItem: () => { throw new Error('quota'); }});
});

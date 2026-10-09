// Settings → Profile's texts (lib/text-handlers.js): read on every store through the engine, edited only where the store has no page of its own.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAX_CHARS, readText, registerTextHandlers, saveText} from '../lib/text-handlers.js';

function fakeStore(links) {
  const written = {};
  return {written, open: () => ({label: links ? 'Notion' : 'This Mac', caps: new Set(links ? ['links'] : []),
    page: name => ({text: async () => `${name} | row`, write: async markdown => { written[name] = markdown; }})})};
}
const call = async (_s, entity, method, {name}) => (entity === 'texts' && method === 'get' ? `# ${name}\n\n- one` : null);

test('every text reads through the engine; this Mac edits it, Notion keeps its page as the editor', async () => {
  for (const name of ['profile', 'answers', 'knowledge']) {
    const mac = fakeStore(false), notion = fakeStore(true);
    assert.deepEqual(await readText({}, name, {call, open: mac.open}), {ok: true, markdown: `# ${name}\n\n- one`, editable: true});
    assert.deepEqual(await readText({}, name, {call, open: notion.open}), {ok: true, markdown: `${name} | row`, editable: false}, 'Notion: its page text, tables included');
    assert.deepEqual(await saveText({}, name, 'new', {open: mac.open}), {ok: true});
    assert.equal(mac.written[name], 'new');
    assert.equal((await saveText({}, name, 'new', {open: notion.open})).ok, false);
    assert.equal(notion.written[name], undefined, 'never a whole-page write on Notion (it would drop the CV file block)');
  }
});

test('an unknown text or an oversized one is refused; the IPC logs what was saved, never the words', async () => {
  const mac = fakeStore(false);
  assert.equal((await readText({}, 'secrets', {call, open: mac.open})).ok, false);
  assert.equal((await saveText({}, 'profile', 'x'.repeat(MAX_CHARS + 1), {open: mac.open})).ok, false);
  const handlers = {}, lines = [];
  registerTextHandlers({ipcMain: {handle: (n, fn) => { handlers[n] = fn; }}, storage: {}, DEMO: false, log: (...l) => lines.push(l), call, open: mac.open});
  assert.equal((await handlers.textSave(null, 'profile', 'private words')).ok, true);
  assert.deepEqual(lines[0], ['store', 'text saved', {name: 'profile', chars: 13}]);
});

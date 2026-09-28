// What a fill needs from Notion, answered at once from the last good read and refreshed in the background (server.kept).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kept} from '../lib/server.js';
import * as viewCache from '../lib/view-cache.js';

function memoryStorage() {
  const files = {};
  return {files, settings: () => ({notionIds: {NOTION_APPLICATIONS_DB: 'ws1'}}),
    readText: name => { if (!(name in files)) throw new Error('ENOENT'); return files[name]; }, writeText: (name, text) => { files[name] = text; }};
}

test('the first read waits for Notion; later ones answer from the kept copy; an old copy is refreshed in the background', async () => {
  const storage = memoryStorage();
  let reads = 0;
  const load = async () => { reads += 1; const result = {contact: {first_name: `Ada${reads}`}}; viewCache.remember(storage, 'contact', result); return result; };
  assert.equal((await kept(storage, 'contact', load)).contact.first_name, 'Ada1');  // nothing kept yet: waits
  const fresh = await kept(storage, 'contact', load);
  assert.equal(fresh.contact.first_name, 'Ada1');  // at once, from the copy
  assert.ok(fresh.fromCache);
  assert.equal(reads, 1);  // no Notion call
  const later = await kept(storage, 'contact', load, {now: Date.now() + 11 * 60 * 1000});
  assert.equal(later.contact.first_name, 'Ada1');  // still at once (the kept copy)…
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reads, 2);  // …while one refresh ran in the background
  assert.equal((await kept(storage, 'contact', load)).contact.first_name, 'Ada2');
});

test('fills in several tabs at once share one Notion read', async () => {
  const storage = memoryStorage();
  let reads = 0;
  const load = async () => { reads += 1; await new Promise(resolve => setTimeout(resolve, 20)); return {notes: []}; };
  await Promise.all([kept(storage, 'knowledge', load), kept(storage, 'knowledge', load), kept(storage, 'knowledge', load)]);
  assert.equal(reads, 1);
});

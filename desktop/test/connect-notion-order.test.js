// Connecting Notion on a Mac whose store is still empty makes Notion the store (startOnNotionIfEmpty); only THEN may the connect decide what moves in
// (migrate.connectSettings reads settings.store: 'sqlite' keeps everything on this Mac, anything else moves this Mac's strategy in). The other order skipped
// the strategy move-in: the Profile page in Notion stayed empty and the strategy stayed on this Mac (12 Oct 2026: e2e wizard, "a Notion token connects").
// Checked in the source, since main.js needs Electron; the real flow is the wizard suite's connect step (e2e/lib/wizard.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');

test('the store is switched to Notion before the connect decides what moves in', () => {
  const from = main.indexOf("const hadLocal = !!(storage.readText('profile.md')");
  const end = main.indexOf('await migrate.run(storage, log)', from);
  assert.ok(from > 0 && end > from, 'the connect block is found');
  const block = main.slice(from, end);
  const switched = block.indexOf('startOnNotionIfEmpty(storage');
  const decided = block.indexOf('migrate.connectSettings(');
  assert.ok(switched >= 0 && decided >= 0, 'both calls are in the block');
  assert.ok(switched < decided, 'startOnNotionIfEmpty runs before migrate.connectSettings');
});

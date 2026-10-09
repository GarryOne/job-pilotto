// Which store the app under test keeps its data in (lib/store.mjs, spec 2026-10-09-store-adapters.md P7): no token by default, CI alternating on a bit
// the AI family does not use, and only a suite that pins it on the real workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {pickFamily} from '../lib/engine.mjs';
import {notionFarSide, pickStore, STORES, storeSettings} from '../lib/store.mjs';
import {E2E} from '../lib/app.mjs';
import {SUITES} from '../lib/context.mjs';

test('a Mac runs on the stand-in unless pinned; E2E_NOTION_STANDIN=1 still means the stand-in', () => {
  assert.equal(pickStore({env: {}}), 'standin');
  assert.equal(pickStore({env: {E2E_STORE: 'sqlite'}}), 'sqlite');
  assert.equal(pickStore({env: {E2E_NOTION_STANDIN: '1'}}), 'standin');
});

test('the real workspace is never picked from the environment, only by a suite', () => {
  assert.throws(() => pickStore({env: {E2E_STORE: 'notion'}}), /only for a suite that pins it/);
  assert.equal(pickStore({env: {E2E_STORE: 'sqlite'}, suiteStore: 'notion'}), 'notion');
  assert.throws(() => pickStore({suiteStore: 'cloud'}), /not "cloud"/);
});

test('CI alternates the store on bit 1, so all four family x store pairs come round in four runs', () => {
  const pairs = new Set();
  for (const run of [0, 1, 2, 3]) {
    const env = {CI: 'true', GITHUB_RUN_NUMBER: String(run), E2E_OPENAI_KEY: 'k'};
    pairs.add(`${pickFamily(env)}/${pickStore({env})}`);
  }
  assert.deepEqual([...pairs].sort(), ['claude/sqlite', 'claude/standin', 'openai/sqlite', 'openai/standin']);
  assert.equal(pickStore({env: {CI: 'true', GITHUB_RUN_NUMBER: '6', E2E_STORE: 'sqlite'}}), 'sqlite');   // a pinned gate leg
});

test('only the sqlite store is written into a fresh profile; the Notion store is the app\'s default', () => {
  assert.deepEqual(storeSettings('sqlite'), {store: 'sqlite'});
  assert.deepEqual(storeSettings('standin'), {});
});

test('every suite that pins a store names a known one, and only notion-real uses the real workspace', async () => {
  for (const name of SUITES) {
    const source = fs.readFileSync(path.join(E2E, 'suites', `${name}.mjs`), 'utf8');
    const pinned = source.match(/^export const store = '([^']*)'/m)?.[1];
    if (!pinned) continue;
    assert.ok(STORES.includes(pinned), `${name}: store '${pinned}'`);
    if (pinned === 'notion') assert.equal(name, 'notion-real', `${name} pins the real Notion workspace: only notion-real may (P7: every suite runs token-free)`);
  }
});

test('Notion\'s far side is real only on the real workspace: the stand-in, or a dead local port on this Mac\'s store', () => {
  assert.equal(notionFarSide({store: 'standin', standIn: 'http://127.0.0.1:5000'}), 'http://127.0.0.1:5000');
  assert.equal(notionFarSide({store: 'sqlite'}), 'http://127.0.0.1:9');
  assert.equal(notionFarSide({store: 'notion'}), 'https://api.notion.com');
  for (const store of ['standin', 'sqlite']) assert.doesNotMatch(notionFarSide({store, standIn: store === 'standin' ? 'http://127.0.0.1:1' : ''}), /notion\.com/);
});

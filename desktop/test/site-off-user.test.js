// Every file that asks the site: a feature the person presses (Free AI, Always on, Ready to send, a report, Pro) works from the owner's app run from source
// (DEV_BUILD) and refuses in tests, the twin, CI and smoke runs; only the automatic traffic keeps the raw switch. A new caller of siteIsOff needs a verdict here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as recipes from '../lib/recipes.js';
import {DEV_BUILD} from '../lib/telemetry.js';
import * as aiFree from '../lib/ai-free.js';

const lib = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib');
const AUTOMATIC = new Set(['recipes.js', 'aliases.js']);   // packs, learning, analytics: stay off for a dev build (a dev run is not learning traffic)
afterEach(() => recipes.setSiteOff(''));

test('every file that checks the switch is a user feature (siteOffForUser) or listed as automatic', () => {
  for (const name of fs.readdirSync(lib).filter(n => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(lib, name), 'utf8');
    if (/\bsiteIsOff\b|\bsiteOffReason\b/.test(text.replace(/\/\/.*$/gm, '')) && !AUTOMATIC.has(name) && name !== 'ready-site.js') assert.fail(`${name} uses the raw siteIsOff: pass a user feature through siteOffForUser, or list it as automatic with its reason`);
  }
});

test('the helper: a dev build passes, every test-like reason refuses', () => {
  recipes.setSiteOff(DEV_BUILD); assert.equal(recipes.siteOffForUser(), false);
  for (const why of ['the end-to-end journey', 'a live-test twin', 'a smoke test', 'CI']) { recipes.setSiteOff(why); assert.equal(recipes.siteOffForUser(), true, why); }
  recipes.setSiteOff(''); assert.equal(recipes.siteOffForUser(), false);
});

test('Free AI starts from a dev build and is refused in CI', async () => {
  const files = {};
  const storage = {readText: n => files[n] ?? null, writeText: (n, t) => { files[n] = t; }, settings: () => ({}), saveSettings() {}, secret: () => '', saveSecret() {}};
  recipes.setSiteOff('CI');
  const refused = await aiFree.start(storage, {}, async () => { throw new Error('must not be asked'); });
  assert.equal(refused.ok, false); assert.match(refused.error, /not a regular install/);
  recipes.setSiteOff(DEV_BUILD);
  let asked = 0;
  await aiFree.start(storage, {}, async () => { asked += 1; throw new Error('stub'); }).catch(() => {});
  assert.ok(asked > 0, 'a dev build asks the site');
});

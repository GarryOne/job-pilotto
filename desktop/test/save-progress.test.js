// Saves that rewrite ⚙️ Search settings say how far they are (7 Oct 2026: Strategy's Save sat on "Saving…" 71 s): every caller goes through one
// helper in main.js, and every button that starts one listens.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {progressWords, withSaveProgress} from '../renderer/save-progress.js';
import {mainSource} from './main-source.js';

test('progress in words: reading, then the share of blocks written', async () => {
  assert.equal(progressWords({stage: 'read'}), 'Reading your settings from Notion…');
  assert.equal(progressWords({stage: 'write', done: 40, total: 108}), 'Saving to Notion · 37%');
  assert.equal(progressWords({stage: 'write', done: 108, total: 108}), 'Saving to Notion · 99%', 'never 100% before the answer');
  let push;
  const said = [];
  const {startListening} = await import('../renderer/save-progress.js');
  startListening({onSettingsProgress: callback => { push = callback; }});
  await withSaveProgress(words => said.push(words), async () => { push({stage: 'read'}); push({stage: 'write', done: 1, total: 4}); });
  push({stage: 'write', done: 2, total: 4});   // after the save: nobody listens
  assert.deepEqual(said, ['Saving to Notion…', 'Reading your settings from Notion…', 'Saving to Notion · 25%']);
});

test('every Search settings save in main.js reports progress, and every renderer caller shows it', () => {
  const main = mainSource();
  const calls = [...main.matchAll(/strategy\.(loosen|addRoles|addPlaces|editLists|retune|setDailyTarget)\(([\s\S]*?)\);/g)];
  assert.ok(calls.length >= 6);
  for (const [, name, args] of calls) assert.match(args, /settingsDeps\(\)/, `strategy.${name} without settingsDeps (no progress told)`);
  const pages = ['pages/strategy.js', 'pages/tune.js', 'pages/focus.js', 'pages/activity.js'].map(file => [file, readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8')]);
  for (const [file, source] of pages) {
    for (const call of source.matchAll(/pilot\.(editTargets|tuneApply|setDailyTarget)\(/g)) {
      const before = source.slice(Math.max(0, call.index - 200), call.index);
      assert.match(before, /withSaveProgress\(/, `${file}: ${call[1]} without withSaveProgress`);
    }
  }
});

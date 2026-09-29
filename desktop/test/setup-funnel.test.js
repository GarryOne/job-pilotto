import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STEPS, track} from '../lib/setup-funnel.js';

test('the steps match the wizard', () => {
  const core = fs.readFileSync(new URL('../renderer/pages/core.js', import.meta.url), 'utf8');
  assert.match(core, new RegExp(`STEPS = \\[${STEPS.map(s => `'${s}'`).join(', ')}\\]`));
});

test('one report per step reached, only moving forward; one when setup finishes', () => {
  const t0 = Date.parse('2026-09-30T10:00:00Z');
  const before = {firstRunAt: '2026-09-30T10:00:00Z'};
  assert.deepEqual(track({wizardStep: 'ai'}, before, t0 + 3 * 60000), {step: 'ai', index: 1, minutes: 3, ai: 'own'});
  assert.equal(track({wizardStep: 'ai'}, {...before, setupFurthest: 'ai'}), null);        // same step again
  assert.equal(track({wizardStep: 'welcome'}, {...before, setupFurthest: 'notion'}), null);  // going back
  assert.equal(track({wizardStep: 'notion'}, {...before, setupFurthest: 'ai', aiTrial: true}).ai, 'trial');
  assert.equal(track({setupDone: true}, {...before, setupFurthest: 'extras'}).step, 'done');
  assert.equal(track({setupDone: true}, {...before, setupDone: true}), null);
  assert.equal(track({theme: 'dark'}, before), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STEPS, track} from '../lib/setup-funnel.js';

test('the steps match the wizard', () => {
  const core = fs.readFileSync(new URL('../renderer/pages/core.js', import.meta.url), 'utf8');
  assert.match(core, new RegExp(`STEPS = \\[${STEPS.map(s => `'${s}'`).join(', ')}\\]`));
  // The website's funnel (/telemetry) counts the same steps, then "done".
  const site = fs.readFileSync(new URL('../../site/src/telemetry.js', import.meta.url), 'utf8');
  // The website keeps 'notion' as a legacy step (older apps reported it; a newer install that went past it counts as having reached it).
  const siteSteps = ['welcome', 'ai', 'notion', 'cv', 'draft', 'extras', 'done'];
  assert.deepEqual(STEPS, siteSteps.filter(s => s !== 'notion' && s !== 'done'));
  assert.match(site, new RegExp(`SETUP_STEPS = \\[${siteSteps.map(s => `'${s}'`).join(', ')}\\]`));
  // Every step has its page in the wizard, and the sidebar lists exactly these.
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.deepEqual([...html.matchAll(/<li data-step="([a-z]+)"/g)].map(m => m[1]), STEPS);
  for (const step of STEPS) assert.match(html, new RegExp(`class="step" data-step="${step}"`));
});

test('one report per step reached, only moving forward; one when setup finishes', () => {
  const t0 = Date.parse('2026-09-30T10:00:00Z');
  const before = {firstRunAt: '2026-09-30T10:00:00Z'};
  assert.deepEqual(track({wizardStep: 'ai'}, before, t0 + 3 * 60000), {step: 'ai', index: 1, minutes: 3, ai: 'own'});
  assert.equal(track({wizardStep: 'ai'}, {...before, setupFurthest: 'ai'}), null);        // same step again
  assert.equal(track({wizardStep: 'welcome'}, {...before, setupFurthest: 'cv'}), null);  // going back
  assert.equal(track({wizardStep: 'cv'}, {...before, setupFurthest: 'ai', aiTrial: true}).ai, 'trial');
  assert.equal(track({setupDone: true}, {...before, setupFurthest: 'extras'}).step, 'done');
  assert.equal(track({setupDone: true}, {...before, setupDone: true}), null);
  assert.equal(track({theme: 'dark'}, before), null);
});

test('why they stopped: a known reason, the step they were on, optional words; asked once, only mid-setup', async () => {
  const {stopped, shouldAskOnQuit} = await import('../lib/setup-funnel.js');
  assert.deepEqual(stopped({reason: 'notion', text: ' no account '}, {wizardStep: 'notion'}),
    {step: 'stopped', where: 'notion', reason: 'notion', mode: 'quit', said: 'no account'});
  assert.equal(stopped({reason: 'nonsense'}, {}), null);
  assert.equal(stopped({reason: 'time', mode: 'stuck'}, {setupFurthest: 'cv'}).where, 'cv');
  assert.equal(shouldAskOnQuit({}, true), true);
  assert.equal(shouldAskOnQuit({setupDone: true}, true), false);
  assert.equal(shouldAskOnQuit({leaveAsked: true}, true), false);
  assert.equal(shouldAskOnQuit({}, false), false);
});

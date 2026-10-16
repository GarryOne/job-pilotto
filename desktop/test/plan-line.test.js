// The one line about Pro on Settings → License while Pro is off (owner, 16 Oct 2026): honest, quiet, and replaced in one place when the plan goes on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {planLine} from '../renderer/plan-line.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the line says what the trial is and what comes after, and nothing else', () => {
  assert.equal(planLine({limit: 20}), 'Free trial: 20 applications or 60 days. Then Pro: $29 one-time, no subscription (coming soon).');
  assert.equal(planLine(), planLine({limit: 20}), 'the default is the same 20');
});

test('the switch is one place: Pro on (test or live) or a key holder shows no line', () => {
  for (const state of [{proMode: 'test'}, {proMode: 'live'}, {licensed: true}, {licensed: true, proMode: 'live'}]) assert.equal(planLine(state), null, JSON.stringify(state));
  for (const state of [{}, {proMode: 'off'}, {proMode: undefined, ended: true}]) assert.ok(planLine(state), JSON.stringify(state));
});

test('it is a quiet line in the allowance panel: no button, no banner, no dialog, nothing in setup or the sidebar counter', () => {
  const html = read('../renderer/index.html'), panel = html.slice(html.indexOf('id="setting-license"'), html.indexOf('id="setting-license-key"'));
  assert.match(panel, /<p class="muted panel-lead" id="license-plan" hidden><\/p>/);
  assert.doesNotMatch(panel.slice(panel.indexOf('id="license-plan"')), /<button/);
  assert.match(read('../renderer/pages/license.js'), /planLine\(state\)/);
  for (const file of ['../renderer/license-chip.js', '../renderer/pages/wizard.js']) assert.doesNotMatch(read(file), /plan-line|planLine|\$29/, `${file} stays as it is`);
});

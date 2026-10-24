// The one line about Pro on Settings → Plan while Pro is off (owner, 16 Oct 2026): honest, quiet, and replaced in one place when the plan goes on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {endedLine, planLine} from '../renderer/plan-line.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the line says what the trial is and what comes after, and nothing else', () => {
  assert.equal(planLine({limit: 20}), 'Then Pro from €9: one-time payment, no subscription (coming soon).');
  assert.equal(planLine(), planLine({limit: 20}), 'the default is the same 20');
});

test('the trial-wall dialog says the same plan line, and Pro on points to the Plan page', () => {
  assert.equal(endedLine({}), 'Pro from €9: one-time payment, no subscription (coming soon).');
  assert.match(endedLine({proMode: 'live'}), /Settings → Plan/);
});

// 17 Oct 2026 (owner: the free trial is open to everyone, "they don't need my founder key anymore"): no screen, dialog or page offers a key.
test('nothing asks for or offers a founder/friend key: no paste field, no "ask Igor", on any screen or page', () => {
  const html = read('../renderer/index.html');
  for (const id of ['license-input', 'license-save', 'allowance-input', 'allowance-unlock', 'license-paste']) assert.doesNotMatch(html, new RegExp(`id="${id}"`), id);
  const files = ['../renderer/index.html', '../renderer/pages/license.js', '../renderer/plan-line.js', '../renderer/license-chip.js', '../lib/app-allowance.js', '../lib/job-actions-handlers.js'];   // the website pages are checked in test/no-key-offers.test.js (its suite runs on site/ changes)
  for (const file of files) assert.doesNotMatch(read(file).replace(/\/\/.*$/gm, ''), /Have a key|got from Igor|Ask Igor|founder key|Paste (?:a|your) license key|Settings → License|Founder keys/i, `${file} offers a key`);
  assert.doesNotMatch(read('../renderer/index.html'), />License</, 'the Settings item and page are called Plan');
});

test('an install that already holds a key keeps it: shown as Founder / Friend, removable, still checked', () => {
  const page = read('../renderer/pages/license.js'), html = read('../renderer/index.html');
  assert.match(page, /founder: 'Founder', friend: 'Friend'/);
  assert.match(page, /setting-license-key'\)\.hidden = !licensed/, 'the key card shows only for a holder');
  assert.match(html, /id="license-remove"/);
  assert.match(page, /state\.license\.name/);
});

test('the switch is one place: Pro on (test or live) or a key holder shows no line', () => {
  for (const state of [{proMode: 'test'}, {proMode: 'live'}, {licensed: true}, {licensed: true, proMode: 'live'}]) assert.equal(planLine(state), null, JSON.stringify(state));
  for (const state of [{}, {proMode: 'off'}, {proMode: undefined, ended: true}]) assert.ok(planLine(state), JSON.stringify(state));
});

// 17 Oct 2026 (owner): the quiet line became the Pro card with a waitlist button (test/pro-waitlist.test.js); the card is gated by the same rule, and nothing else shows the price.
test('the Pro card replaces the quiet line: gated by planLine, no price in the sidebar counter or the setup wizard', () => {
  const html = read('../renderer/index.html');
  assert.doesNotMatch(html, /id="license-plan"/);
  assert.match(html, /id="setting-pro-waitlist"/);
  assert.match(read('../renderer/plan-line.js'), /showsProWaitlist = state => planLine\(state\) !== null/);
  for (const file of ['../renderer/license-chip.js', '../renderer/pages/wizard.js']) assert.doesNotMatch(read(file), /plan-line|planLine|\$29/, `${file} stays as it is`);
});

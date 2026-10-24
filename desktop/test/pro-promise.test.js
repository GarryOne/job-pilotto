// Every place Pro is offered says "one-time payment, no subscription" from the one words module (owner, 24 Oct 2026); a spot without it fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {model} from '../renderer/hosted-words.js';
import {chip} from '../renderer/license-chip.js';
import {endedLine, planLine} from '../renderer/plan-line.js';
import {BADGE, PROMISE, promise} from '../renderer/pro-promise.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const free = {licensed: false, used: 3, limit: 20, daysLeft: 40};
const paused = reason => model({on: true, email: 'a@b.c'}, {state: 'paused', pause_reason: reason}).line;

test('the phrase is one-time payment, no subscription, never lifetime', () => {
  assert.equal(PROMISE, 'One-time payment, no subscription');
  assert.equal(BADGE, `✓ ${PROMISE}`);
  assert.doesNotMatch(read('../renderer/pro-promise.js').replace(/\/\/.*$/gm, ''), /lifetime/i);
});

test('every Pro offer line says it: the free-plan line, the trial wall, the chip tooltips and the Always on pause lines', () => {
  const spots = {
    planLine: planLine({limit: 20}), endedLine: endedLine({}), chipFree: chip(free).title, chipEnded: chip({...free, ended: true, used: 20, daysLeft: 0}).title,
    chipPro: chip({licensed: true, license: {kind: 'pro'}, pro: {creditPercent: 60}}).title, trialOver: paused('trial-over'), budget: paused('budget'),
  };
  for (const [name, text] of Object.entries(spots)) assert.ok(text.toLowerCase().includes(promise()), `${name}: ${text}`);
});

test('the cards and the palette use the shared module, not their own copy', () => {
  for (const file of ['../renderer/pages/nav.js', '../renderer/pages/plan-waitlist.js']) assert.match(read(file), /pro-promise\.js/, file);
  assert.doesNotMatch(read('../renderer/pages/nav.js') + read('../renderer/pages/plan-waitlist.js'), /'One-time payment, no subscription'/);
});

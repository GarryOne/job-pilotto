// Guards tools/claim-shape.mjs: two fixer sessions can never hold the same pool row, a dead or expired claim is taken over, only the holder releases.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {claim, release, list, slug, TTL_MS} from '../../tools/claim-shape.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));   // never the real claims folder
const NOW = Date.parse('2026-10-11T12:00:00Z');

test('a row is claimed by one session; a second one is told who holds it', () => {
  const d = dir();
  assert.equal(claim('jobs.ch posting whose Apply the extension did not find', 'job-pilotto-81', {dir: d, now: NOW}).ok, true);
  const second = claim('jobs.ch posting whose Apply the extension did not find', 'job-pilotto-b8', {dir: d, now: NOW + 1000});
  assert.equal(second.ok, false);
  assert.equal(second.holder, 'job-pilotto-81');
  assert.equal(claim('jobs.ch posting whose Apply the extension did not find', 'job-pilotto-81', {dir: d, now: NOW + 2000}).ok, true, 'the holder may claim again (renews)');
});

test('a claim of an expired or no-longer-listed session is taken over, a live one is not', () => {
  const d = dir();
  claim('Nebius', 'old-session', {dir: d, now: NOW});
  assert.equal(claim('Nebius', 'new', {dir: d, now: NOW + 1000, alive: ['old-session', 'new']}).ok, false, 'listed and fresh: held');
  assert.equal(claim('Nebius', 'new', {dir: d, now: NOW + 1000, alive: ['new']}).ok, true, 'holder gone from ListAgents: taken over');
  claim('Ocado', 'old-session', {dir: d, now: NOW});
  assert.equal(claim('Ocado', 'new', {dir: d, now: NOW + TTL_MS + 1}).ok, true, 'expired: taken over');
});

test('only the holder releases; list shows live claims; two names that slug alike are one row', () => {
  const d = dir();
  claim('Red Badger', 'a', {dir: d, now: NOW});
  assert.equal(release('Red Badger', 'b', {dir: d}).ok, false);
  assert.deepEqual(list({dir: d, now: NOW + 1000}).map(c => [c.name, c.session]), [['Red Badger', 'a']]);
  assert.equal(slug('Red  Badger!'), slug('red badger'));
  assert.equal(release('Red Badger', 'a', {dir: d}).ok, true);
  assert.deepEqual(list({dir: d, now: NOW}), []);
});

test('many sessions claiming at once: exactly one wins', async () => {
  const d = dir();
  const results = await Promise.all(Array.from({length: 12}, (_, i) => Promise.resolve().then(() => claim('Swatch Group careers', `s${i}`, {dir: d, now: NOW}))));
  assert.equal(results.filter(r => r.ok).length, 1);
});

test('a lock with its own short life (the e2e page, 30 min) expires before the 6 h default, and the holder renews it', () => {
  const d = dir(), HALF_HOUR = 30 * 60 * 1000;
  assert.equal(claim('e2e-page', 'a', {dir: d, now: NOW, ttl: HALF_HOUR}).ok, true);
  assert.equal(claim('e2e-page', 'b', {dir: d, now: NOW + HALF_HOUR - 1000}).ok, false);
  assert.equal(claim('e2e-page', 'a', {dir: d, now: NOW + HALF_HOUR - 1000, ttl: HALF_HOUR}).ok, true, 'renewed');
  assert.equal(claim('e2e-page', 'b', {dir: d, now: NOW + 2 * HALF_HOUR}).ok, true, 'expired after the renewed 30 min');
});

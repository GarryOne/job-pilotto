// Test builds (lib/canary.js): the canary rule matches tools/canary_promote.py on one shared fixture, and the owner's
// app stays on the canary for its trial instead of jumping to the newest pre-release.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {canaryOf, check, plan} from '../lib/canary.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/canary_builds.json', import.meta.url), 'utf8'));

test('the canary rule is the same as canary_promote.py (shared fixture)', () => {
  for (const c of FIXTURE.cases) assert.equal(canaryOf(c.releases, Date.parse(c.now))?.tagName ?? null, c.canary, c.name);
});

const NOW = Date.parse('2026-10-05T12:00:00Z');
const at = hours => new Date(NOW - hours * 3600000).toISOString();
const rel = (n, hours, extra = {}) => ({tagName: `desktop-v0.4.0-alpha.${n}`, isPrerelease: true, isDraft: false, isLatest: false, createdAt: at(hours), ...extra});
const stable = n => rel(n, 200, {isPrerelease: false, isLatest: true});
const RELEASES = [rel(70, 2), rel(68, 20), rel(66, 30), stable(60)];

test('older than the canary: offer the canary, not the newest build', () => {
  const result = plan({current: '0.4.0-alpha.60', releases: RELEASES, now: NOW});
  assert.equal(result.state, 'behind');
  assert.equal(result.offer.tagName, 'desktop-v0.4.0-alpha.66');
  assert.equal(result.newest.tagName, 'desktop-v0.4.0-alpha.70');
});

test('on the canary within its trial: nothing offered, one plain line', () => {
  const result = plan({current: '0.4.0-alpha.66', releases: RELEASES, now: NOW, since: at(5)});
  assert.equal(result.state, 'trial');
  assert.equal(result.offer, null);
  assert.equal(result.line, 'Test build alpha.66 — trial 1 of 2 days');
  assert.equal(plan({current: '0.4.0-alpha.66', releases: RELEASES, now: NOW, since: at(30)}).line, 'Test build alpha.66 — trial 2 of 2 days');
  assert.match(plan({current: '0.4.0-alpha.66', releases: RELEASES, now: NOW, since: at(50)}).line, /trial done/);
});

test('canary promoted: the next canary is offered', () => {
  const promoted = [rel(70, 2), rel(68, 20), stable(66)];
  const result = plan({current: '0.4.0-alpha.66', releases: promoted, now: NOW});
  assert.equal(result.offer.tagName, 'desktop-v0.4.0-alpha.68');
});

test('canary dropped (7 days, or its release page deleted when it failed): the next one is offered', () => {
  const old = [rel(70, 2), rel(68, 20), rel(66, 7 * 24 + 1), stable(60)];
  assert.equal(plan({current: '0.4.0-alpha.66', releases: old, now: NOW}).offer.tagName, 'desktop-v0.4.0-alpha.68');
  const deleted = [rel(70, 2), rel(68, 20), stable(60)];
  assert.equal(plan({current: '0.4.0-alpha.66', releases: deleted, now: NOW}).offer.tagName, 'desktop-v0.4.0-alpha.68');
});

test('escape hatch: a skipped canary offers nothing until the canary changes; ahead of it offers nothing', () => {
  const skipped = plan({current: '0.4.0-alpha.70', releases: RELEASES, now: NOW, skip: 'desktop-v0.4.0-alpha.66'});
  assert.equal(skipped.state, 'skipped');
  assert.equal(skipped.offer, null);
  assert.equal(skipped.line, 'Test build alpha.70 · out of the trial of alpha.66');
  const next = plan({current: '0.4.0-alpha.60', releases: [rel(70, 2), rel(68, 20), stable(66)], now: NOW, skip: 'desktop-v0.4.0-alpha.66'});
  assert.equal(next.offer.tagName, 'desktop-v0.4.0-alpha.68');  // a new canary: the trial resumes
  assert.equal(plan({current: '0.4.0-alpha.70', releases: RELEASES, now: NOW}).state, 'ahead');
});

test('no canary: stable when it is newer, else nothing', () => {
  assert.equal(plan({current: '0.4.0-alpha.58', releases: [stable(60)], now: NOW}).offer.tagName, 'desktop-v0.4.0-alpha.60');
  assert.equal(plan({current: '0.4.0-alpha.60', releases: [stable(60)], now: NOW}).offer, null);
});

test('check reads the release list + latest, and offers the canary download for this computer', async () => {
  const rest = (n, hours, pre = true) => ({tag_name: `desktop-v0.4.0-alpha.${n}`, name: `0.4 Alpha ${n}`, prerelease: pre, draft: false,
    created_at: at(hours), html_url: `https://gh/${n}`, assets: [{name: `Job-Pilotto-0.4.0-alpha.${n}-arm64.zip`, browser_download_url: `https://dl/${n}`, size: 1}]});
  const list = [rest(70, 2), rest(66, 30), rest(60, 200, false)];
  const fetcher = async url => ({ok: true, json: async () => (url.endsWith('/latest') ? list[2] : list)});
  const result = await check('0.4.0-alpha.60', {fetcher, platform: 'darwin', now: NOW});
  assert.equal(result.offer.download, 'https://dl/66');
  assert.equal(result.newestOffer.download, 'https://dl/70');
  assert.equal(result.canary, 'desktop-v0.4.0-alpha.66');
  assert.equal(result.newestIsCanary, false);
});

// Test builds (menu → Get Test Builds): the app stays on one canary build for its 48 h trial, not the newest build.
// So tools/canary_promote.py gets 2 days of reports from one build. canaryOf is the same rule as canary_promote.py canary_of (tests/fixtures/canary_builds.json pins both).
import {REPO, asset, newer} from './updater.js';

export const WINDOW_MS = 7 * 24 * 3600 * 1000;  // a canary not promoted within 7 days is dropped
export const TRIAL_MS = 48 * 3600 * 1000;       // what canary_promote.py needs: reports spanning 48 h
// Builds older than this can't pass the trial (no run counts / no Get Test Builds): never the canary, never block newer
// ones. Same value as tools/canary_promote.py CANARY_FLOOR.
export const CANARY_FLOOR = '0.4.0-alpha.69';

// Releases in the `gh release list --json` shape: {tagName, isPrerelease, isDraft, isLatest, createdAt}.
const newerThanStable = releases => {
  const stable = releases.find(r => r.isLatest) || null;
  return {stable, newer: releases.filter(r => r.isPrerelease && !r.isDraft && (!stable || newer(r.tagName, stable.tagName)))};
};
const oldest = list => list.reduce((best, r) => (!best || newer(best.tagName, r.tagName) ? r : best), null);
const newest = list => list.reduce((best, r) => (!best || newer(r.tagName, best.tagName) ? r : best), null);

// The canary build: the oldest non-draft pre-release newer than the current stable, created within the last 7 days.
export function canaryOf(releases, now = Date.now(), floor = CANARY_FLOOR) {
  const eligible = r => now - Date.parse(r.createdAt) < WINDOW_MS && (!floor || !newer(`desktop-v${floor}`, r.tagName));
  return oldest(newerThanStable(releases).newer.filter(eligible));
}

const version = tag => String(tag || '').replace(/^desktop-v/, '');
const short = tag => version(tag).split('-').slice(1).join('-') || version(tag);  // 0.4.0-alpha.66 -> alpha.66

// What a test-build app should do: {offer: release|null, state, canary, newest, line}.
//   behind  : older than the canary -> offer the canary
//   trial   : on the canary -> nothing newer until it's promoted, dropped (7 days / failed) or replaced
//   ahead   : newer than the canary (installed by hand) -> nothing offered
//   skipped : "Update to the newest test build now" left this canary's trial -> nothing offered until the canary changes
//   none    : no canary -> stable, when it's newer
// `skip` = the canary tag that was skipped; `since` = when this app started running `current` (ISO).
export function plan({current, releases, now = Date.now(), skip = '', since = ''}) {
  const {stable, newer: builds} = newerThanStable(releases);
  const canary = canaryOf(releases, now);
  const latest = newest(builds.filter(r => newer(r.tagName, current))) || (stable && newer(stable.tagName, current) ? stable : null);
  const base = {canary, newest: latest};
  if (!canary) {
    const offer = stable && newer(stable.tagName, current) ? stable : null;
    return {...base, offer, state: 'none', line: offer ? '' : `Test build ${short(current)} · no trial running`};
  }
  if (skip && skip === canary.tagName) {
    return {...base, offer: null, state: 'skipped', line: `Test build ${short(current)} · out of the trial of ${short(canary.tagName)}`};
  }
  if (newer(canary.tagName, current)) return {...base, offer: canary, state: 'behind', line: ''};
  if (newer(current, canary.tagName)) {
    return {...base, offer: null, state: 'ahead', line: `Test build ${short(current)} · newer than the trial build ${short(canary.tagName)}`};
  }
  const ran = since ? now - Date.parse(since) : 0;
  const line = ran >= TRIAL_MS ? `Test build ${short(current)} — trial done, waiting for the promotion`
    : `Test build ${short(current)} — trial ${Math.min(2, Math.floor(Math.max(0, ran) / 86400000) + 1)} of 2 days`;
  return {...base, offer: null, state: 'trial', line};
}

// GitHub's REST release -> the shape above.
export const fromRest = (release, latestTag) => ({tagName: release.tag_name, isPrerelease: !!release.prerelease,
  isDraft: !!release.draft, isLatest: release.tag_name === latestTag, createdAt: release.created_at, rest: release});

// An offer in updater.check's shape, or null when the release has no download for this computer.
export function toOffer(release, platform = process.platform) {
  const rest = release?.rest;
  const download = rest && asset(rest, platform);
  if (!download) return null;
  return {version: version(rest.tag_name), name: rest.name || version(rest.tag_name), notes: String(rest.body || '').slice(0, 2000),
    url: rest.html_url, download: download.browser_download_url, size: download.size, tag: rest.tag_name};
}

// Reads the releases and plans: {offer, newestOffer, state, canary, line}.
export async function check(current, {fetcher = globalThis.fetch, platform = process.platform, now = Date.now(), skip = '', since = ''} = {}) {
  const get = async url => {
    const response = await fetcher(url, {headers: {Accept: 'application/vnd.github+json'}});
    if (!response.ok && response.status !== 404) throw new Error(`GitHub answered ${response.status}`);
    return response.ok ? response.json() : null;
  };
  const [list, latest] = await Promise.all([get(`https://api.github.com/repos/${REPO}/releases?per_page=100`),
    get(`https://api.github.com/repos/${REPO}/releases/latest`)]);
  const releases = (list || []).map(release => fromRest(release, latest?.tag_name));
  const result = plan({current, releases, now, skip, since});
  return {offer: toOffer(result.offer, platform), newestOffer: toOffer(result.newest, platform), state: result.state,
    canary: result.canary?.tagName || null, newestIsCanary: !!result.newest && result.newest === result.canary, line: result.line};
}

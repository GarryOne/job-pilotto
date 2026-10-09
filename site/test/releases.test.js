// The app's update check reads releases here (src/releases.js), not from api.github.com's 60-an-hour unsigned limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {releases} from '../src/releases.js';

const RELEASE = {tag_name: 'desktop-v0.6.19', name: '0.6.19', body: 'Notes', html_url: 'https://github.com/x', prerelease: false, draft: false, author: {login: 'x'},
  assets: [{name: 'Job-Pilotto-0.6.19-x64.exe', browser_download_url: 'https://dl/exe', size: 9, uploader: {}}]};
const memoryCache = () => { const kept = new Map(); return {match: async r => kept.get(r.url)?.clone(), put: async (r, a) => { kept.set(r.url, a); }}; };

test('the latest release is read once with the site token and served from the cache after that', async () => {
  const calls = [];
  const cache = memoryCache();
  const fetcher = async (url, init) => { calls.push({url, auth: init.headers.Authorization}); return Response.json(RELEASE); };
  const ctx = {waitUntil: promise => promise};
  for (let i = 0; i < 3; i++) {
    const answer = await releases(new Request('https://site/api/releases/latest?x=' + i), {GITHUB_TOKEN: 't'}, ctx, {fetcher, cache});
    assert.equal(answer.status, 200);
    const body = await answer.json();
    assert.equal(body.tag_name, 'desktop-v0.6.19');
    assert.deepEqual(body.assets, [{name: 'Job-Pilotto-0.6.19-x64.exe', browser_download_url: 'https://dl/exe', size: 9}], 'only what the updater reads');
    assert.equal(body.author, undefined);
  }
  assert.equal(calls.length, 1, 'one GitHub call for every install in the cache window, whatever the query');
  assert.deepEqual(calls[0], {url: 'https://api.github.com/repos/GarryOne/job-pilotto/releases/latest', auth: 'Bearer t'});
});

test('the release list keeps prerelease and draft, which the beta and test channels decide on', async () => {
  const fetcher = async url => { assert.match(url, /releases\?per_page=30$/); return Response.json([RELEASE, {...RELEASE, tag_name: 'desktop-v0.6.20', prerelease: true}]); };
  const body = await (await releases(new Request('https://site/api/releases'), {}, {}, {fetcher, cache: null})).json();
  assert.deepEqual(body.map(r => [r.tag_name, r.prerelease, r.draft]), [['desktop-v0.6.19', false, false], ['desktop-v0.6.20', true, false]]);
});

test('GitHub refusing is a 502 nobody caches, so the app falls back to GitHub itself', async () => {
  const cache = memoryCache();
  const answer = await releases(new Request('https://site/api/releases/latest'), {}, {waitUntil: p => p}, {fetcher: async () => new Response('', {status: 403}), cache});
  assert.equal(answer.status, 502);
  assert.equal(await cache.match(new Request('https://site/api/releases/latest')), undefined);
});

test('the router sends both paths here and nothing else under /api/releases', async () => {
  const answer = await worker.fetch(new Request('https://site/api/releases/latest', {method: 'POST'}), {}, {});
  assert.equal(answer.status, 405, 'the releases handler answered');
  const other = await worker.fetch(new Request('https://site/api/releases/../admin'), {}, {}).catch(() => null);
  assert.notEqual(other?.status, 405);
});

// The /self-heal page: the owner's view of what the self-healing loops spend on AI, behind the stats key like /stats.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {page, view} from '../src/selfheal.js';

const env = {STATS_KEY: 'secret'};

test('/self-heal is owner-only: a stranger gets 404, the key sets the cookie, the cookie opens the page', async () => {
  assert.equal(view(new Request('https://x.dev/self-heal'), env).status, 404);
  assert.equal(view(new Request('https://x.dev/self-heal?key=wrong'), env).status, 404);
  const first = view(new Request('https://x.dev/self-heal?key=secret'), env);
  assert.equal(first.status, 302);
  assert.match(first.headers.get('Set-Cookie'), /HttpOnly/);
  const cookie = first.headers.get('Set-Cookie').split(';')[0];
  const opened = view(new Request('https://x.dev/self-heal', {headers: {Cookie: cookie}}), env);
  assert.equal(opened.status, 200);
  assert.equal(opened.headers.get('X-Robots-Tag'), 'noindex');
  assert.match(await opened.text(), /self-healing AI spend/);
});

test('it is never a static page: static assets are served to anyone before the Worker', () => {
  assert.equal(existsSync(new URL('../public/self-heal.html', import.meta.url)), false);
});

test('totals are computed from the rows: Fixer $1.117, 4 PRs, 2 merged, 476 Finder reviews', () => {
  const html = page();
  assert.match(html, /\$1\.12<\/b>/);
  assert.match(html, /4 PRs, 2 merged/);
  assert.match(html, /<td class="n">476<\/td>/);
  assert.match(html, /2 of 4/);
});

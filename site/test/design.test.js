// /admin/design (src/design.js): the design system page and snapshot go only to a signed-in admin, as the page with the admin menu or as a plain file; anyone else gets the 404 of any admin page.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GROUPS, PAGES} from '../src/admin.js';
import {designView} from '../src/design.js';

const files = {'/admin/design/': ['<!doctype html><html><head></head><body><header><h1>Design</h1></header></body></html>', 'text/html'],
  '/admin/design/snapshot.zip': ['PK', 'application/zip'], '/admin/design/r/tokens.css': [':root{}', 'text/css']};
const env = (extra = {}) => ({STATS_KEY: 'k', STATS_API_KEY: 'owner-key', ASSETS: {fetch: async request => {
  const hit = files[new URL(request.url).pathname];
  return hit ? new Response(hit[0], {headers: {'Content-Type': hit[1]}}) : new Response('no', {status: 404});
}}, ...extra});
const get = (path, auth = 'owner-key', e = env()) => designView(new Request(`https://x.test${path}`, {headers: auth ? {Authorization: `Bearer ${auth}`} : {}}), e);

test('signed out, a wrong key or no assets: the same 404 as any admin page', async () => {
  assert.equal((await get('/admin/design', null)).status, 404);
  assert.equal((await get('/admin/design/snapshot.zip', 'wrong')).status, 404);
  assert.equal((await get('/admin/design', 'owner-key', env({ASSETS: undefined}))).status, 404);
});

test('the page comes with the admin menu, no caching and noindex; files and the zip go out plain', async () => {
  const page = await get('/admin/design');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /admin-nav/);
  assert.match(html, /🎨 Design/);
  assert.match(html, /admin-question/);
  assert.doesNotMatch(html, /background:#0b0d10;color:#f4efe3/, 'the shared dark page style must not restyle the app\'s components');
  assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(page.headers.get('X-Robots-Tag'), 'noindex');
  assert.equal((await get('/admin/design/')).status, 200);
  const zip = await get('/admin/design/snapshot.zip');
  assert.match(zip.headers.get('Content-Disposition'), /attachment; filename="job-pilotto-design-system\.zip"/);
  assert.equal(await (await get('/admin/design/r/tokens.css')).text(), ':root{}');
  assert.equal((await get('/admin/design/missing.js')).status, 404);
  assert.equal((await get('/admin/design/../../etc')).status, 404);
});

test('the menu has a Design group with the page in it', () => {
  assert.ok(GROUPS.some(([name]) => name === 'Design'));
  assert.ok(PAGES.some(page => page.path === '/admin/design' && page.group === 'Design' && page.question));
});

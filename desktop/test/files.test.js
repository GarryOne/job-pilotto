// Mac-only files kept safe: the CV (every version) and tailored CVs in Notion, the rest in a weekly backup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as backup from '../lib/backup.js';
import * as files from '../lib/files.js';
import {createStorage} from '../lib/storage.js';

const plain = {encrypt: v => v, decrypt: v => v};
function storage() {
  const s = createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'Job Pilotto'), plain);
  fs.writeFileSync(s.path('cv.pdf'), '%PDF cv');
  s.saveSettings({setupDone: true, cvName: 'CV_final.pdf', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_APPLICATIONS_DB: 'apps'}});
  s.setSecret('NOTION_TOKEN', 'ntn');
  return s;
}
// A fake Notion: file uploads, the Profile's blocks, Applications rows.
function notion({rows = []} = {}) {
  const calls = [], blocks = [];
  const reply = data => ({ok: true, json: async () => data});
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push([init.method, route, body]);
    if (route === 'file_uploads') return reply({id: `up${calls.length}`});
    if (route.endsWith('/send')) return reply({status: 'uploaded'});
    if (route === 'blocks/profile/children' && init.method === 'GET') return reply({results: blocks, has_more: false});
    if (route === 'blocks/profile/children') {
      const made = body.children.map((c, i) => ({id: `b${blocks.length + i}`, type: c.type, [c.type]: c[c.type]}));
      const at = body.after ? blocks.findIndex(b => b.id === body.after) + 1 : blocks.length;
      const plainText = rich => (rich || []).map(t => ({...t, plain_text: t.text?.content || ''}));
      blocks.splice(at, 0, ...made.map(b => ({...b, [b.type]: {...b[b.type], rich_text: plainText(b[b.type].rich_text)}})));
      return reply({results: made});
    }
    if (route === 'databases/apps/query') return reply({results: rows.filter(r => r.url === body.filter.url.equals)});
    return reply({});
  };
  return {fetcher, calls, blocks};
}

test('the CV goes to the Profile under "📎 CV", once per version, newest first', async () => {
  const s = storage(), n = notion();
  const first = await files.syncCv(s, n.fetcher);
  assert.match(first.uploaded, /^CV_final\.pdf · \d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(await files.syncCv(s, n.fetcher), {skipped: 'already in Notion'});  // same file: nothing sent
  fs.writeFileSync(s.path('cv.pdf'), '%PDF cv v2');
  await files.syncCv(s, n.fetcher);
  assert.equal(n.blocks.filter(b => b.type === 'heading_2').length, 1);
  assert.deepEqual(n.blocks.map(b => b.type), ['heading_2', 'file', 'file']);
  assert.equal(n.calls.filter(([, route]) => route === 'file_uploads').length, 2);
});

test('a tailored CV lands on the job\'s Applications row; no row -> it stays on the Mac', async () => {
  const s = storage(), n = notion({rows: [{id: 'row1', url: 'https://jobs/1'}]});
  const pdf = path.join(s.dir, 't.pdf');
  fs.writeFileSync(pdf, '%PDF tailored');
  assert.equal(await files.tailoredToApplication('ntn', 'apps', 'https://jobs/1', pdf, 'CV · Acme.pdf', n.fetcher), true);
  const patch = n.calls.find(([method, route]) => method === 'PATCH' && route === 'pages/row1');
  assert.equal(patch[2].properties['Tailored CV'].files[0].name, 'CV · Acme.pdf');
  assert.equal(await files.tailoredToApplication('ntn', 'apps', 'https://jobs/2', pdf, 'x.pdf', n.fetcher), false);
});

test('a file over Notion\'s 5 MB limit is refused with a clear reason', async () => {
  const big = path.join(os.tmpdir(), `jp-big-${process.pid}.pdf`);
  fs.writeFileSync(big, Buffer.alloc(files.MAX_BYTES + 1));
  await assert.rejects(files.upload('ntn', big, 'big.pdf', async () => { throw new Error('not called'); }), /up to 5 MB/);
  fs.rmSync(big);
});

test('weekly backup: due after 7 days, keeps the last 4, never the keys', () => {
  const s = storage();
  s.setSecret('ANTHROPIC_API_KEY', 'sk-secret');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-backups-'));
  assert.equal(backup.due({}), true);
  for (let day = 1; day <= 6; day++) backup.run(s, {target, now: new Date(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`)});
  const kept = fs.readdirSync(target).sort();
  assert.equal(kept.length, 4);
  assert.match(kept[0], /2026-09-03/);
  assert.equal(backup.due(s.settings(), Date.parse('2026-09-10T10:00:00Z')), false);
  assert.equal(backup.due(s.settings(), Date.parse('2026-09-13T10:00:00Z')), true);
  const listing = String(fs.readFileSync(path.join(target, kept[3])));
  assert.ok(!listing.includes('sk-secret'));
  assert.equal(backup.folder('/home/x', () => false), path.join('/home/x', 'Documents', 'Job Pilotto Backups'));  // \\ on Windows
});

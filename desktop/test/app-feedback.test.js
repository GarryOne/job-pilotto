import test from 'node:test';
import assert from 'node:assert/strict';
import {send} from '../lib/app-feedback.js';

const storage = () => { let s = {}; return {settings: () => s, saveSettings: patch => { s = {...s, ...patch}; }}; };

test('sends the words, the optional contact, the version and one stable install id', async () => {
  const sent = [];
  const st = storage();
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}'); };
  assert.deepEqual(await send({text: '  Setup took 20 min ', contact: 'ana@x.ch'}, {storage: st, version: '0.4.0', platform: 'darwin', fetcher}), {ok: true});
  await send({text: 'Again'}, {storage: st, version: '0.4.0', fetcher});
  assert.equal(sent[0].text, 'Setup took 20 min');
  assert.equal(sent[0].contact, 'ana@x.ch');
  assert.equal(sent[0].install, sent[1].install);
  assert.ok(sent[0].install.length >= 8);
});

test('empty, too long, rate-limited and offline each say what to do', async () => {
  const ok = async () => new Response('{}');
  assert.match((await send({text: ' '}, {storage: storage(), version: '1', fetcher: ok})).error, /few words/);
  assert.match((await send({text: 'x'.repeat(2001)}, {storage: storage(), version: '1', fetcher: ok})).error, /2000/);
  assert.match((await send({text: 'hi'}, {storage: storage(), version: '1', fetcher: async () => new Response('', {status: 429})})).error, /tomorrow/);
  assert.match((await send({text: 'hi'}, {storage: storage(), version: '1', fetcher: async () => { throw new Error('offline'); }})).error, /connection/);
});

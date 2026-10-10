// Connect with LinkedIn, app side (lib/linkedin-oauth.js, lib/experience-handlers.js, renderer/pages/experience.js): the session id travels to the
// site and back, the profile is collected once, a token is never kept, and the window offers connect, "use my name and email" and disconnect.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {cancel, connect, kept} from '../lib/linkedin-oauth.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const PROFILE = {ok: true, sub: 's1', name: 'Ada Example', given_name: 'Ada', family_name: 'Example', email: 'ada@example.test', locale: 'en'};

test('connect opens the start page with a session, waits, and returns the profile the site kept', async () => {
  let opened = '', polls = 0;
  const fetcher = async (url, init) => {
    polls++;
    assert.match(url, /\/api\/linkedin\/token$/);
    assert.equal(JSON.parse(init.body).session, new URL(opened).searchParams.get('session'));
    return new Response(JSON.stringify(polls < 3 ? {ok: false, pending: true} : PROFILE), {status: 200});
  };
  const answer = await connect(url => { opened = url; }, {fetcher, sleep: async () => {}, site: 'https://site.test'});
  assert.match(opened, /^https:\/\/site\.test\/api\/linkedin\/start\?session=[A-Za-z0-9_-]{43}$/);
  assert.equal(answer.ok, true);
  assert.equal(polls, 3);
});

test('not set up on the server, cancelled, or no answer: a clear error, no profile', async () => {
  assert.match((await connect(() => {}, {fetcher: async () => new Response('{}', {status: 503}), sleep: async () => {}, site: 'https://x'})).error, /isn't available yet/);
  assert.match((await connect(() => {}, {fetcher: async () => new Response('{"ok":false,"pending":true}'), sleep: async () => {}, every: 1000, timeout: 3000, site: 'https://x'})).error, /5 minutes/);
  const waiting = connect(() => {}, {fetcher: async () => new Response('{"ok":false,"pending":true}'), sleep: async () => { cancel(); }, site: 'https://x'});
  assert.equal((await waiting).error, 'Cancelled.');
});

test('the app keeps who it is, never a token or a picture', () => {
  const saved = kept(PROFILE, new Date('2026-10-10T12:00:00Z'));
  assert.deepEqual(saved, {sub: 's1', name: 'Ada Example', givenName: 'Ada', familyName: 'Example', email: 'ada@example.test', connectedAt: '2026-10-10T12:00:00.000Z'});
});

test('the window offers connect, use my name and email, and disconnect; the app answers each', () => {
  const page = read('../renderer/pages/experience.js'), handlers = read('../lib/experience-handlers.js'), preload = read('../preload.cjs'), html = read('../renderer/index.html');
  assert.match(html, /id="exp-linkedin-line"/);
  for (const text of ['Connect with LinkedIn', 'Use my name and email', 'Disconnect']) assert.ok(page.includes(text), text);
  assert.match(page, /saveContactField\(key/, 'fills only through the existing one-detail save, which merges and never replaces');
  assert.match(page, /!String\(contact\?\.\[key\] \|\| ''\)\.trim\(\)/, 'only details that are still empty');
  for (const name of ['linkedinStatus', 'linkedinConnect', 'linkedinDisconnect']) {
    assert.match(handlers, new RegExp(`ipcMain.handle\\('${name}'`), name);
    assert.match(preload, new RegExp(`${name}: call\\('${name}'\\)`), name);
  }
  assert.doesNotMatch(handlers, /appLog\('linkedin', [^)]*(name|email)/, 'the log says that it happened, never who');
});

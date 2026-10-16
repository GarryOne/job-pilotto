// Hosted Always on, the daily digest (src/hosted-notify.js): one e-mail per run with new matches through the mail module, at most one every 4 h, off after a bounce or unsubscribe.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {result, schedule, startRun} from '../src/hosted.js';
import {addrOf} from '../src/mail.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0083_mail.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, at TEXT)');
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }});
  return {db, prepare: text => statement(text)};
}
const env = () => { const sent = []; return {sent, STATS: d1(), STATS_SALT: 'salt', HOSTED_ALWAYS_ON: 'on', MAIL: 'on', EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}}; };
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const t0 = new Date('2026-10-16T10:00:00Z'), later = h => new Date(t0.getTime() + h * 3600000);
async function setup() {
  const e = env();
  await schedule(new Request('https://x/s', {method: 'PUT', headers: {'x-api-key': await keyOf('install-aaaa1')}, body: JSON.stringify({on: true, email: 'a@example.com'})}), e, t0);
  return e;
}
async function finish(e, matches, at, slotHours = 0) {
  const sched = e.STATS.db.prepare('SELECT * FROM hosted_schedules').get();
  const run = await startRun(e, {...sched, next_run_at: later(slotHours).toISOString()}, at);
  return (await result(new Request('https://x/r', {method: 'POST', headers: {authorization: `Bearer ${run.token}`}, body: JSON.stringify({matches})}), e, at)).json();
}
const matches = n => Array.from({length: n}, (_, i) => ({job: `j${i}-${Math.random()}`, title: `Job ${i}`, company: 'Acme', url: `https://a/${i}`, fit: i}));

test('a run with new matches sends one digest with the top five; an empty run sends nothing', async () => {
  const e = await setup();
  assert.equal((await finish(e, [], later(1))).mailed, false);
  assert.equal(e.sent.length, 0);
  assert.equal((await finish(e, matches(8), later(2), 1)).mailed, true);
  assert.equal(e.sent.length, 1);
  assert.equal(e.sent[0].to, 'a@example.com');
  assert.match(e.sent[0].subject, /^8 new job matches$/);
  assert.match(e.sent[0].text, /Job 7/);
  assert.doesNotMatch(e.sent[0].text, /Job 2\b/);   // top five by fit only
});

test('a second digest within 4 hours is not sent, one after 4 hours is', async () => {
  const e = await setup();
  await finish(e, matches(2), later(1), 0);
  assert.equal((await finish(e, matches(2), later(2), 1)).mailed, false);
  assert.equal((await finish(e, matches(2), later(5.5), 5)).mailed, true);
  assert.equal(e.sent.length, 2);
});

test('an unsubscribe or a bounce turns the schedule\'s email channel off; the run still stores its matches', async () => {
  const e = await setup();
  e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'all', 'bounce', ?)").run(await addrOf('a@example.com'), t0.toISOString());
  const done = await finish(e, matches(3), later(1));
  assert.deepEqual([done.ok, done.stored, done.mailed], [true, 3, false]);
  assert.equal(e.STATS.db.prepare('SELECT email_channel FROM hosted_schedules').get().email_channel, 0);
  assert.equal(e.sent.length, 0);
});

test('with the mail switch off the run still succeeds and nothing is sent', async () => {
  const e = await setup(); e.MAIL = 'off';
  const done = await finish(e, matches(2), later(1));
  assert.deepEqual([done.ok, done.mailed], [true, false]);
  assert.equal(e.sent.length, 0);
});

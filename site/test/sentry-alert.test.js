// The Sentry Telegram bot (src/sentry-alert.js): new / regressed / spiking issues only, once each, at most 20 an hour, never an e2e or planted error; fake Sentry and Telegram.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {check, kindOf, spiking, message} from '../src/sentry-alert.js';

const NOW = Date.parse('2026-10-16T12:00:00Z'), old = '2026-10-01T00:00:00Z';
const issue = (id, extra = {}) => ({id: String(id), shortId: `JOB-PILOTTO-APP-${id}`, title: `Error ${id}`, level: 'error', count: '5', userCount: 2, culprit: 'src/x.py in run',
  firstSeen: old, lastSeen: '2026-10-16T11:59:00Z', permalink: `https://job-pilotto.sentry.io/issues/${id}/`, substatus: 'ongoing', metadata: {type: 'Error'}, ...extra});
const flat = n => ({'24h': Array.from({length: 24}, (_, i) => [i, n])});

function world(issues) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0080_sentry_alerts.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), first: async () => db.prepare(sql).get(...args) ?? null});
  const sentry = [], telegram = [], urls = [];
  const fetcher = async (url, init) => {
    url = String(url); urls.push(url);
    if (url.includes('/tags/release/')) return new Response(JSON.stringify({topValues: [{name: '0.9.1'}]}));
    if (url.includes('sentry.io/api')) return new Response(JSON.stringify(issues));
    if (url.includes('api.telegram.org')) { telegram.push(JSON.parse(init.body)); return new Response('{}'); }
    return new Response('[]');
  };
  const env = {STATS: {prepare: sql => statement(sql)}, SENTRY_AUTH_TOKEN: 't', SENTRY_TELEGRAM_TOKEN: 'bot', SENTRY_TELEGRAM_CHAT: '42', SENTRY_TELEGRAM: 'on'};
  return {db, env, fetcher, telegram, urls, sentry};
}

test('what counts: new, regressed, spike; an ongoing quiet issue is nothing', () => {
  assert.equal(kindOf(issue(1, {substatus: 'new'}), NOW), 'new');
  assert.equal(kindOf(issue(2, {firstSeen: '2026-10-16T11:30:00Z'}), NOW), 'new');
  assert.equal(kindOf(issue(3, {substatus: 'regressed'}), NOW), 'regressed');
  assert.equal(kindOf(issue(4, {stats: flat(3)}), NOW), null);
  const jump = {'24h': [...flat(2)['24h'].slice(0, 23), [23, 40]]};
  assert.ok(spiking({stats: jump}) && !spiking({stats: {'24h': [...flat(2)['24h'].slice(0, 23), [23, 15]]}}), '10x the usual and at least 20 events');
  assert.equal(kindOf(issue(5, {stats: jump}), NOW), 'spike');
});

test('one message per issue, with its facts; the same issue is not told again on the next run', async () => {
  const w = world([issue(1, {substatus: 'new', level: 'fatal'}), issue(2)]);
  assert.deepEqual(await check(w.env, w.fetcher, NOW), {told: 1, held: 0, skipped: 0});
  const text = w.telegram[0].text;
  for (const part of ['New', 'crash', 'Error 1', 'src/x.py in run', '2 users', '5 events', 'v0.9.1', '2026-10-01 00:00', 'issues/1/', '/admin/sentry']) assert.ok(text.includes(part), part);
  assert.equal(w.telegram[0].chat_id, '42');
  assert.equal((await check(w.env, w.fetcher, NOW + 300000)).told, 0);
  assert.equal(w.telegram.length, 1);
});

test('a spike is told at most once an hour; a regression once a week', async () => {
  const jump = {'24h': [...flat(2)['24h'].slice(0, 23), [23, 60]]};
  const w = world([issue(5, {stats: jump}), issue(6, {substatus: 'regressed'})]);
  assert.equal((await check(w.env, w.fetcher, NOW)).told, 2);
  assert.equal((await check(w.env, w.fetcher, NOW + 30 * 60000)).told, 0);
  assert.equal((await check(w.env, w.fetcher, NOW + 61 * 60000)).told, 1, 'only the spike again');
});

test('over 20 an hour: the rest are summarised once, not told one by one or again', async () => {
  const w = world(Array.from({length: 25}, (_, i) => issue(i + 10, {substatus: 'new'})));
  assert.deepEqual(await check(w.env, w.fetcher, NOW), {told: 20, held: 5, skipped: 0});
  assert.equal(w.telegram.length, 21);
  assert.match(w.telegram.at(-1).text, /5 more Sentry issues/);
  assert.equal((await check(w.env, w.fetcher, NOW + 300000)).held, 0, 'held ones are not retried into a new summary');
});

test('only production is asked; a planted test error never reaches the bot', async () => {
  const w = world([issue(7, {substatus: 'new', metadata: {type: 'RecallPlant'}}), issue(8, {substatus: 'new', title: 'Error: recall planted rejection'})]);
  assert.equal((await check(w.env, w.fetcher, NOW)).told, 0);
  assert.match(w.urls[0], /environment=production/);
  assert.equal(w.telegram.length, 0);
});

test('switched off or not set up: no call at all', async () => {
  for (const change of [{SENTRY_TELEGRAM: 'off'}, {SENTRY_TELEGRAM_TOKEN: ''}, {SENTRY_TELEGRAM_CHAT: undefined}, {SENTRY_AUTH_TOKEN: ''}]) {
    const w = world([issue(1, {substatus: 'new'})]);
    await check({...w.env, ...change}, w.fetcher, NOW);
    assert.equal(w.urls.length, 0, JSON.stringify(change));
  }
});

test('text from Sentry cannot break the message markup; the fixer\'s pull request is linked', () => {
  const html = message(issue(9, {title: '<b>x</b> & y'}), 'new', {version: '', base: 'https://b', fix: {pulls: [{head: {ref: 'sentry-fix/job-pilotto-app-9'}, state: 'open', merged_at: null, html_url: 'https://github.com/x/pull/9'}], verdicts: []}});
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt; &amp; y') && html.includes('https://github.com/x/pull/9'));
});

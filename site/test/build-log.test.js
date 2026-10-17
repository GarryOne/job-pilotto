// The Build log (src/build-log.js): the CI ingest (key, shape, one row a day, a closed day stays closed) and the owner's page.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES} from '../src/admin.js';
import {LINE, cleanGroups, cut, ingest, page} from '../src/build-log.js';
import {SYSTEM, daysToRun, plan, zurichHour} from '../src/build-digest.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, body, key = 'pub') => call(e, '/digest/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
const groups = [{emoji: '🧭', title: 'Apply flow', bullets: [{lead: 'Radio groups', text: 'A radio question is named by its own question.', prs: [957, 959]}]}];
const digest = (extra = {}) => ({day: '2026-10-16', groups, open: 'The bot token.', numbers: [957, 959], usd: 0.004, ...extra});

test('the ingest needs the key and a well-formed digest', async () => {
  const e = env();
  assert.equal((await put(e, digest(), 'wrong')).status, 404);
  assert.equal((await call(e, '/digest/data?day=2026-10-16')).status, 404);
  assert.equal((await put(e, {...digest(), day: 'today'})).status, 400);
  assert.equal((await put(e, {...digest(), groups: [{emoji: '', title: 'x', bullets: []}]})).status, 400);
  assert.equal((await call(e, '/digest/data?day=nope', {headers: {Authorization: 'Bearer pub'}})).status, 400);
  assert.equal(cleanGroups(groups)[0].bullets[0].prs.length, 2);
});

test('a draft is rewritten (drafts and cost add up), the final one closes the day, a later draft is ignored', async () => {
  const e = env(), get = async () => (await call(e, '/digest/data?day=2026-10-16', {headers: {Authorization: 'Bearer pub'}})).json();
  assert.deepEqual((await get()).numbers, null);
  await put(e, digest());
  await put(e, digest({numbers: [957, 959, 960], usd: 0.006}));
  const draft = await get();
  assert.deepEqual([draft.numbers, draft.drafts, draft.finalAt], [[957, 959, 960], 2, null]);
  assert.equal(e.STATS.db.prepare('SELECT usd FROM digest_days').get().usd.toFixed(3), '0.010');
  assert.equal((await (await put(e, digest({final: true, numbers: [957, 959, 960]}))).json()).final, true);
  assert.equal((await (await put(e, digest({open: 'changed', numbers: [1]}))).json()).ignored, 'day is closed');
  const closed = await get();
  assert.ok(closed.finalAt);
  assert.deepEqual(closed.numbers, [957, 959, 960]);
});

test('the page is the owner\'s: 404 without the key, days newest first with their groups, PR links, Draft/Final and an empty state', async () => {
  const e = env();
  assert.equal((await call(e, '/admin/operations/build-log')).status, 404);
  const empty = await (await call(e, '/admin/operations/build-log', {headers: {Cookie: 'jp_stats=k3y'}})).text();
  assert.match(empty, /No digest yet/);
  await put(e, digest({day: '2026-10-15', numbers: [900, 901, 902, 905], final: true}));
  await put(e, digest());
  const html = await (await call(e, '/admin/operations/build-log', {headers: {Cookie: 'jp_stats=k3y'}})).text();
  assert.ok(html.indexOf('16 Oct') < html.indexOf('15 Oct'));
  assert.match(html, /Draft 1/);
  assert.match(html, /Final/);
  assert.match(html, /🧭 Apply flow/);
  assert.match(html, /<a href="https:\/\/github.com\/GarryOne\/job-pilotto\/pull\/957">#957<\/a>/);
  assert.match(html, /4 PRs, #900-#905/);
  assert.match(await (await call(e, '/admin/operations/build-log?day=2026-10-15', {headers: {Cookie: 'jp_stats=k3y'}})).text(), /^(?![\s\S]*16 Oct<\/b>)/);
  assert.ok(!page([{day: '2026-10-16', groups: JSON.stringify([{emoji: '<b>', title: '<script>x</script>', bullets: []}]), open_line: '<i>', numbers: '[]', drafts: 1, usd: 0, updated_at: '2026-10-16T10:00:00Z', final_at: null}]).includes('<script>x'));
});

test('the menu lists the Build log under Operations', () => {
  const entry = PAGES.find(item => item.path === '/admin/operations/build-log');
  assert.equal(entry.group, 'Operations');
});

test('each goal is a card with its PR count; a long line is cut at a word and folds its full text; a short one does not; the prompt asks for the short form', () => {
  const long = 'A radio group is now named by the question above it, so forms that repeat Yes and No no longer fill the wrong answer.';
  const two = [{emoji: '🧭', title: 'Apply flow', bullets: [{lead: 'Radio', text: long, prs: [957, 959]}, {lead: 'Dropdown', text: 'Short line.', prs: [960]}]}, {emoji: '🛠️', title: 'Admin', bullets: [{lead: 'Menu', text: 'Five groups.', prs: [961]}]}];
  const html = page([{day: '2026-10-16', groups: JSON.stringify(two), open_line: '', numbers: '[957,959,960,961]', drafts: 1, usd: 0.01, updated_at: '2026-10-16T10:00:00Z', final_at: null}]);
  assert.equal((html.match(/<section class="card goal">/g) || []).length, 2);
  assert.match(html, /Apply flow <span class="muted">3 PRs<\/span>/);
  assert.match(html, /Admin <span class="muted">1 PR<\/span>/);
  assert.match(html, /<details><summary><b>Radio<\/b> <span class="muted">A radio group is now named[^<]*…<\/span><\/summary><p class="muted">A radio group is now named by the question above it, so forms that repeat Yes and No no longer fill the wrong answer\.<\/p>/);
  assert.doesNotMatch(html, /<details><summary><b>Dropdown/);
  assert.ok(cut(long).length <= LINE + 1 && cut('Short.') === 'Short.');
  assert.match(SYSTEM, new RegExp(`text up to ${LINE} characters`));
});

test('a closed day is replaced only by an explicit rewrite, and stays closed', async () => {
  const e = env();
  await put(e, digest({final: true}));
  const text = groups => ({...digest(), groups, rewrite: true});
  const short = [{emoji: '🧭', title: 'Apply flow', bullets: [{lead: 'Radio', text: 'Radio groups read right.', prs: [957, 959]}]}];
  assert.equal((await (await put(e, digest({groups: short}))).json()).ignored, 'day is closed');
  const done = await (await put(e, text(short))).json();
  assert.deepEqual([done.final, done.rewritten], [true, true]);
  const html = await (await call(e, '/admin/operations/build-log', {headers: {Cookie: 'jp_stats=k3y'}})).text();
  assert.match(html, /Radio groups read right/);
  assert.match(html, /Final/);
});

test('a day closes only from 23:00 Zurich: a rewrite or final of today stays a draft (no Telegram: final false), and an early final counts as a draft', async () => {
  const e = env(), day = '2026-10-17';
  const send = (body, now) => ingest(new Request('https://x/digest/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify(body)}), e, new Date(now)).then(r => r.json());
  const get = now => ingest(new Request(`https://x/digest/data?day=${day}`, {headers: {Authorization: 'Bearer pub'}}), e, new Date(now)).then(r => r.json());
  const today = {...digest({day}), final: true, rewrite: true};
  const early = await send(today, '2026-10-17T18:53:00Z');   // 20:53 in Zurich
  assert.deepEqual([early.final, early.rewritten], [false, false]);   // the Telegram step posts only when final is true
  assert.equal((await get('2026-10-17T19:00:00Z')).finalAt, null);
  e.STATS.db.prepare('UPDATE digest_days SET final_at = ? WHERE day = ?').run('2026-10-17T18:53:00Z', day);   // what the old code stored
  assert.equal((await get('2026-10-17T19:00:00Z')).finalAt, null);
  assert.match(page([e.STATS.db.prepare('SELECT * FROM digest_days WHERE day = ?').get(day)]), /Draft/);
  const night = await send({...digest({day}), final: true}, '2026-10-17T21:30:00Z');   // 23:30 in Zurich
  assert.equal(night.final, true);
  assert.ok((await get('2026-10-17T22:00:00Z')).finalAt);
  assert.equal((await send({...digest({day}), final: true}, '2026-10-17T22:30:00Z')).ignored, 'day is closed');
});

test('a day with no run between 23:00 and 02:00 is closed by the next run at 10:00, once, and posts once', async () => {
  const e = env(), day = '2026-10-16', now = new Date('2026-10-17T08:00:00Z');   // 10:00 in Zurich on D+1
  await put(e, digest({day, numbers: [900]}));   // the last draft of D
  const stored = async () => (await call(e, `/digest/data?day=${day}`, {headers: {Authorization: 'Bearer pub'}})).json();
  const run = async () => {
    const [before] = daysToRun(now);
    assert.deepEqual(before, {day, late: true});   // D is looked at on D+1 whatever the hour
    const decision = plan({now, numbers: [900, 901], stored: await stored(), late: before.late, zurichHour: zurichHour(now)});
    if (decision.skip) return {decision, posts: 0};
    const result = await put(e, digest({day, numbers: [900, 901], final: decision.final})).then(r => r.json());
    return {decision, posts: decision.final && result.final && !result.ignored && !result.rewritten ? 1 : 0};
  };
  assert.deepEqual(await run().then(r => [r.decision.final, r.posts]), [true, 1]);
  assert.deepEqual(await run().then(r => [r.decision.skip, r.posts]), ['closed', 0]);   // the next hour: closed, nothing more
  assert.deepEqual(daysToRun(now, '2026-10-10'), [{day: '2026-10-10'}]);   // --day still means exactly that day
});

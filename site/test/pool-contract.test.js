// The engine-site contract of the shared pool (7 Oct 2026): the bodies the engine really sends (fixtures/pool-payloads.json, made by the engine's own
// code in tools/pool_e2e.py, kept current by tests/test_pool_contract.py) go into the real intake: nothing is dropped, and every field arrives in the
// totals the central scout reads. A name changed on one side only fails here instead of looking like "no data yet".
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';

const MIGRATIONS = ['0001_stats.sql', '0002_telemetry.sql', '0003_contributions.sql', '0027_contributions_v2.sql', '0028_nofeed.sql', '0031_board_reads.sql',
  '0032_pool_indexes.sql', '0033_pool_outcomes.sql', '0034_pool_fine_tags.sql', '0035_pool_daily.sql', '0045_pool_ai_family.sql'];
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of MIGRATIONS) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)})});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const map = new Map(); return {get: async k => map.get(k) ?? null, put: async (k, v) => { map.set(k, v); }}; };
const BODIES = JSON.parse(readFileSync(new URL('./fixtures/pool-payloads.json', import.meta.url), 'utf8'));

test('every body the engine sends is kept whole, and every field reaches the totals', async () => {
  const env = {STATS: d1(), WAITLIST: kv(), STATS_SALT: 'salt', INDEX_PUBLISH_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')}};
  assert.ok(BODIES.length >= 3, 'the fixture holds the instant shares and the end-of-check share');
  for (const body of BODIES) {
    const reply = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/contribute', {method: 'POST', body: JSON.stringify(body)}), env, {});
    const answer = await reply.json();
    assert.equal(reply.status, 200, JSON.stringify(answer));
    assert.equal(answer.dropped, undefined, `the site dropped ${JSON.stringify(answer.dropped)} of a body the engine sends`);
  }
  const read = async query => (await worker.fetch(new Request(`https://www.jobpilotto.workers.dev/api/contributions${query}`, {headers: {Authorization: 'Bearer k3y'}}), env, {})).json();
  const all = await read('');
  const sent = BODIES.flatMap(body => body.feeds).filter(feed => feed.out);
  assert.ok(sent.length, 'the fixture carries outcomes');
  for (const feed of sent) {
    const got = all.feeds.find(item => item.slug === feed.slug);
    for (const step of ['strong', 'interview']) assert.equal(got.out[step], feed.out[step] || 0, `${feed.slug}: ${step}`);
    for (const field of ['langs', 'senior']) if (feed.out[field]) assert.deepEqual(got.out[field], feed.out[field], `${feed.slug}: ${field}`);
  }
  const labels = BODIES[0];
  const feed = all.feeds.find(item => item.slug === sent[0].slug);
  for (const name of ['countries', 'metros', 'families']) for (const tag of labels[name]) assert.ok(tag in feed[name], `${name} ${tag} on ${feed.slug}`);
  const boards = BODIES.flatMap(body => body.boards || []);
  for (const board of boards) {
    const got = all.boards.find(item => item.board === board.board);
    assert.ok(got, `board ${board.board}`);
    assert.equal(got.dup, board.dup || 0, `${board.board}: dup`);
  }
  const dead = (await read('?part=nofeed')).nofeed;
  for (const item of BODIES.flatMap(body => body.nofeed || [])) assert.ok(dead.some(row => row.company === item.company), `dead end ${item.company}`);
});

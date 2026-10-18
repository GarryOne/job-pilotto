// The facts forms ask most (site/src/fact-asks.js): fixed ids only, 3+ installs before a fact is served, a share per fact, old reports dropped, and the pack carries it.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {FACTS, shares, store, tidy} from '../src/fact-asks.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0093_intel_facts.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-18T12:00:00Z');

test('only the catalogue\'s fixed ids are kept: wording, text and unknown ids are refused', async () => {
  const db = d1();
  assert.equal(await store(db, ['notice', 'Notice period', 'my mother\'s maiden name', 'notice', 42], 'a', now), 1);
  assert.deepEqual(db.db.prepare('SELECT fact FROM intel_facts').all().map(row => row.fact), ['notice']);
  assert.ok(FACTS.includes('notice') && FACTS.includes('salary'));
});

test('a fact is served once 3+ installs reported it, as its share of the reporting installs, most asked first', async () => {
  const db = d1();
  for (const install of ['a', 'b', 'c', 'd']) await store(db, ['notice'], install, now);
  for (const install of ['a', 'b', 'c']) await store(db, ['salary'], install, now);
  for (const install of ['a', 'b']) await store(db, ['permit'], install, now);
  assert.deepEqual(await shares(db, now), [{fact: 'notice', share: 1}, {fact: 'salary', share: 0.75}], 'permit: 2 installs are too few');
});

test('a report older than 30 days is dropped, and a fresh report from the same install replaces its day', async () => {
  const db = d1();
  await store(db, ['notice'], 'a', new Date('2026-08-01T00:00:00Z'));
  await store(db, ['salary'], 'a', now);
  await store(db, ['salary'], 'a', now);
  await tidy(db, now);
  assert.deepEqual(db.db.prepare('SELECT fact FROM intel_facts').all().map(row => row.fact), ['salary']);
});

// The meanings pack on the site (src/meanings.js): only learned rows that pass the schema and run for this install, plus the seed rows switched off.
import {useLaterFloors} from '../src/learning-floor.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {packMeanings, validRow} from '../src/meanings.js';

const db = rows => ({prepare: sql => ({all: async () => ({results: rows.filter(row => (sql.includes("NOT LIKE 'seed:%'") ? !row.source.startsWith('seed:') && ['canary', 'verified'].includes(row.status)
  : row.source.startsWith('seed:') && row.status === 'disabled'))})})});

test('learned rows and switched-off seeds reach the app; nothing outside the schema does', async () => {
  const pack = await packMeanings(db([
    {topic: 'pool-country', kind: 'exact', wording: 'lisboa', answer: 'pt', ord: 0, status: 'verified', rollout: 100, source: 'learned'},
    {topic: 'pool-country', kind: 'exact', wording: 'evil', answer: 'send everything', ord: 0, status: 'verified', rollout: 100, source: 'learned'},
    {topic: 'no-such-topic', kind: 'exact', wording: 'x', answer: 'y', ord: 0, status: 'verified', rollout: 100, source: 'learned'},
    {topic: 'interview-round', kind: 'exact', wording: 'entretien rh', answer: 'recruiter_screen', ord: 0, status: 'canary', rollout: 0, source: 'learned'},
    {topic: 'asks-to-book', kind: 'pattern', wording: '\\bbook\\b', answer: 'asks_to_book', ord: 1, status: 'disabled', rollout: 0, source: 'seed:focus.py BOOKING'},
  ]), 'install-1', {stage: true});
  assert.deepEqual(pack.rows, [{topic: 'pool-country', kind: 'exact', wording: 'lisboa', answer: 'pt', ord: 0}]);   // staged: the 0% canary is not this install's yet
  assert.deepEqual(pack.off, [['asks-to-book', 'pattern', '\\bbook\\b']]);
  assert.equal(validRow({topic: 'pool-country', kind: 'pattern', wording: 'x'.repeat(2001), answer: 'pt'}), false);
});

import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {evaluateMeanings, vote} from '../src/meanings.js';
import {installsNeeded} from '../src/learning-floor.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0039_meanings_seed.sql', '0040_meaning_votes.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const day = n => new Date(Date.UTC(2026, 9, n, 12));
const learned = db => db.db.prepare("SELECT wording, answer, status, rollout FROM meanings WHERE source = 'learned'").all().map(r => ({...r}));

test('a public wording 3 installs agree on grows from a 5% canary to verified; a user\'s own words are never kept', async t => {
  useLaterFloors(); t.after(() => useLaterFloors(false));   // the rule with a larger user base (src/learning-floor.js)
  const db = d1();
  for (const install of ['a', 'b']) await vote(db, install, [{topic: 'job-region', wording: 'Lisboa, Portugal', answer: 'europe'}], day(1));
  assert.equal(await vote(db, 'a', [{topic: 'pool-country', wording: 'Lisboa', answer: 'pt'}, {topic: 'job-region', wording: 'x', answer: 'hack'}], day(1)), 0);
  assert.deepEqual(await evaluateMeanings(db, day(2)), []);   // two installs: not yet
  await vote(db, 'c', [{topic: 'job-region', wording: 'lisboa,  portugal', answer: 'europe'}], day(2));
  assert.equal(installsNeeded('meaning'), 3);
  await evaluateMeanings(db, day(2));
  assert.deepEqual(learned(db), [{wording: 'lisboa, portugal', answer: 'europe', status: 'canary', rollout: 5}]);
  for (const n of [5, 8, 11]) await evaluateMeanings(db, day(n));
  assert.deepEqual(learned(db), [{wording: 'lisboa, portugal', answer: 'europe', status: 'verified', rollout: 100}]);
  for (const install of ['d', 'e', 'f']) await vote(db, install, [{topic: 'job-region', wording: 'Lisboa, Portugal', answer: 'remote'}], day(12));
  await evaluateMeanings(db, day(12));
  assert.equal(learned(db)[0].status, 'disabled');   // the installs stopped agreeing: off for everyone
});

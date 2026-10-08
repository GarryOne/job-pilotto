// The meanings pack on the site (src/meanings.js): only learned rows that pass the schema and run for this install, plus the seed rows switched off.
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
  ]), 'install-1');
  assert.deepEqual(pack.rows, [{topic: 'pool-country', kind: 'exact', wording: 'lisboa', answer: 'pt', ord: 0}]);   // the 0% canary is not this install's yet
  assert.deepEqual(pack.off, [['asks-to-book', 'pattern', '\\bbook\\b']]);
  assert.equal(validRow({topic: 'pool-country', kind: 'pattern', wording: 'x'.repeat(2001), answer: 'pt'}), false);
});

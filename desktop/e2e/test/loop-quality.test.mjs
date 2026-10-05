// The five loop-quality numbers: real counts, and null with a reason when there is no data (never a made-up value).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {escapeRate, loopQuality} from '../lib/loop-quality.mjs';

const row = (caught, at = '2026-10-04') => ({properties: {'Caught by e2e': {select: {name: caught}}, 'Found on': {date: {start: at}}}});
const now = Date.parse('2026-10-06T00:00:00Z');

test('escape rate: missed of judged, late counted apart, n/a and old rows left out', () => {
  const result = escapeRate([row('Yes'), row('Yes'), row('Late (only after users or manual)'), row('No - gap'), row('n/a'), row('No - gap', '2026-07-01')], {now});
  assert.deepEqual(result, {rate: 25, missed: 1, late: 1, caught: 2, judged: 4});
});

test('every number says why when there is no data, and counts when there is', () => {
  const empty = loopQuality({});
  for (const key of ['escape', 'mutation', 'verdicts']) assert.equal(empty[key].rate, null, key);
  assert.match(empty.escape.note, /Bug Tracker/);
  const at = '2026-10-05T10:00:00Z';
  const issue = (labels, extra = {}) => ({state: 'OPEN', createdAt: at, body: '🟠 **MEDIUM** · test-failure · x', labels: labels.map(name => ({name})), comments: [], ...extra});
  const fixed = issue([], {state: 'CLOSED', stateReason: 'COMPLETED', comments: [{body: 'Fixed by https://github.com/o/r/pull/1'}]});
  const audit = {body: '- [x] 👍 right <!-- audit:i1:right -->\n- [ ] 👎 wrong <!-- audit:i1:wrong -->\n- [ ] 👍 right <!-- audit:i2:right -->\n- [x] 👎 wrong <!-- audit:i2:wrong -->'};
  const full = loopQuality({issues: [issue(['flaky']), issue([]), issue(['regression']), fixed, fixed], audits: [audit], mutation: {score: 80, killed: 4, survived: 1, unknown: 0, at},
    tracker: [row('Yes'), row('No - gap')]});
  assert.equal(full.flake.rate, 20);
  assert.equal(full.regression.rate, 50);
  assert.equal(full.verdicts.rate, 50);
  assert.equal(full.mutation.rate, 80);
  assert.equal(full.escape.rate, 50);
});

// An insight's two breakdowns of the same thing ("Eligible jobs by family: …" and "Good-fit hits by family: … (x%)") read as one
// comparison table; without both, nothing changes and the lines stay evidence (owner's fix #9, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonTable} from '../renderer/insight-card.js';

const totals = 'Eligible jobs by family: software 38, platform 43, sre 19, cloud_infrastructure 27';
const hits = 'Good-fit hits by family: software 1 (2.6%), platform 12 (28%), sre 7 (37%), cloud_infrastructure 3 (11%)';

test('hits of the total and the rate per key, highest rate first; the two lines are used', () => {
  const table = comparisonTable([totals, hits, 'Overall role_fit score averages only 34/100']);
  assert.deepEqual(table.columns, ['Family', 'Good-fit hits', 'Rate']);
  assert.deepEqual(table.rows.map(row => [row.key, row.of, row.rate]),
    [['SRE', '7 of 19', '37%'], ['Platform', '12 of 43', '28%'], ['Cloud infrastructure', '3 of 27', '11%'], ['Software', '1 of 38', '3%']]);
  assert.deepEqual(table.used, [hits, totals]);
});

test('no comparison without both breakdowns, or when their keys differ', () => {
  assert.equal(comparisonTable([hits]), null);
  assert.equal(comparisonTable([totals]), null);
  assert.equal(comparisonTable([hits, 'Eligible jobs by family: software 38, platform 43']), null);
  assert.equal(comparisonTable(['6 of 7 replies arrived within 0-2 days']), null);
});

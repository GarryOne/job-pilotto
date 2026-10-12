// Whether a PR's live proof can visit its row's site today (owner, 12 Oct 2026, via job-pilotto-cc: every check on a PR is required, so a proof that cannot run for a
// reason outside the PR, a site out of CI visits or resting after a block page, must be SKIPPED, never red). The pick job of .github/workflows/pool-proof.yml prepares
// CI's ledger of today the way the run does (pool-ci-state.mjs prepare) and asks the run's own rule (lib/site-ledger.mjs guardLiveVisit) without recording a visit.
// A refused row is no row: the proof job is skipped and the NOT RUN line goes to the PR as a comment. Guard: e2e/test/pool-proof-visit.test.mjs.
import {SiteLimitError, guardLiveVisit} from './site-ledger.mjs';
import {nextDay} from './pool-ci.mjs';

// The row's posting address in the pool list (desktop/e2e/smoke-sites.json): its first url, the one the run visits; '' when the row has none there.
export const rowUrl = (row, sites = {}) => (sites.shapes || []).find(item => item.shape === row)?.urls?.[0] || '';

// -> {row, skipped}: the row the proof runs ('' when skipped), and the NOT RUN line ('' when it runs). A row with no public address: the run decides (it says NOT RUN itself).
export function planProof({row = '', url = '', env = process.env, now = new Date()} = {}) {
  if (!row || !url) return {row, skipped: ''};
  try {
    guardLiveVisit(url, {env, now, who: 'PR proof pick', record: false, log: () => {}});
    return {row, skipped: ''};
  } catch (error) {
    if (!(error instanceof SiteLimitError)) throw error;
    const found = String(error.message).match(/site-ledger: (\S+) is not visited: (.*?)\. Counted/);
    return {row: '', skipped: `NOT RUN: ${row}: the site limit (${found ? `${found[1]}: ${found[2]}` : String(error.message).slice(0, 140)}), next visit possible after ${nextDay(now)}`};
  }
}

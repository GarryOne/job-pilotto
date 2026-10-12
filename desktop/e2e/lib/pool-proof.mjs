// The live proof on a PR (owner, 12 Oct 2026; .github/workflows/pool-proof.yml): which pool row (desktop/e2e/smoke-sites.json) a PR's own build runs once on a GitHub runner. A commit's
// "Pool-row: <row>" line starts it on open and on each push (the first named row); the "live-proof" label starts it for any PR; a "live-row: <row words>" line in
// the PR body names the row and wins. A row not in the repo's pool list, a fork (no secrets) or no row named is one neutral line, never a guess.
// Guard: e2e/test/pool-proof.test.mjs.
import {rowFor} from '../../../tools/pool-rows.mjs';

export const LABEL = 'live-proof';

const poolRowOf = messages => messages.flatMap(message => [...String(message).matchAll(/^Pool-row:[ \t]*(.*)$/gm)].map(found => found[1].trim()))
  .find(value => value && !/^none(\s|$)/i.test(value)) || '';   // "Pool-row: none <why>" names no row (tools/rung-trailer.mjs)
const liveRowOf = body => (String(body || '').match(/^live-row:[ \t]*(.+)$/im) || [])[1]?.trim() || '';
const privateRow = value => ({row: '', note: `not in the repo's pool: "${value}" is not in desktop/e2e/smoke-sites.json; add it there, or run it on the Mac: cd desktop/e2e && npm run live -- <its posting>`});

// A Pool-row line is a row's exact name or its slug (the commit hook checks it against the Mac's whole pool).
function fromPoolRow(value, names) {
  const row = rowFor(value, names);
  return row ? {row, note: `Pool-row in the PR's commits: ${row}`} : privateRow(value);
}

// A live-row line may be words of one row, as `npm run smoke -- --only` takes them.
function fromLiveRow(value, names) {
  const exact = rowFor(value, names), hits = exact ? [exact] : names.filter(name => name.includes(value));
  if (hits.length === 1) return {row: hits[0], note: `live-row in the PR body: ${hits[0]}`};
  if (hits.length > 1) return {row: '', note: `live-row "${value}" matches ${hits.length} pool rows: name one exactly (${hits.join('; ')})`};
  return privateRow(value);
}

// action: the pull_request event's action; label: the label just added (labeled); labels: the PR's labels; messages: its commits' messages, oldest first;
// publicNames: the rows of desktop/e2e/smoke-sites.json; fork: the PR comes from another repository. -> {row, note} (row '' = nothing runs; note '' = not ours).
export function pickProofRow({action = '', label = '', labels = [], body = '', messages = [], publicNames = [], fork = false} = {}) {
  if (action === 'labeled' && label !== LABEL) return {row: '', note: ''};
  const labeled = label === LABEL || labels.includes(LABEL), poolRow = poolRowOf(messages), liveRow = liveRowOf(body);
  if (!poolRow && !labeled) return {row: '', note: 'no Pool-row line in the commits and no live-proof label: no live proof'};
  if (fork) return {row: '', note: 'a fork\'s PR has no secrets: no live proof'};
  if (liveRow) return fromLiveRow(liveRow, publicNames);
  if (poolRow) return fromPoolRow(poolRow, publicNames);
  return {row: '', note: 'live-proof: no row named; add "live-row: <row words>" to the PR body (or a "Pool-row:" line to a commit)'};
}

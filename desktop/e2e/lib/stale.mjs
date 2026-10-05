// A finding that comes back on a build older than the fix that closed it is not a regression (5 Oct 2026: the gate tested release 0.5.2, built at 3806ebe; #275, #276 and #277 had
// been fixed by e47ad68 after it, and #291, #292 and #294 were filed as "the fix did not hold"). Before a refiled finding is called a regression, its fix commit must be in the
// build that was tested: git's own answer (the compare API says whether the tested build is behind the fix). Conservative: when anything is unclear, it is not stale.
const SHA = /\b([0-9a-f]{7,40})\b/;
const FIX_WORDS = [/Closed: commit ([0-9a-f]{7,40}) says it fixes this/, /Fixed by (?:commit )?([0-9a-f]{7,40})\b/i, /Fixed in ([0-9a-f]{7,40})\b/i];
const PR = /Fixed by https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/i;

// The commit that fixed a closed issue, from its comments: a commit named, or a pull request (`merged(number)` -> its merge commit). '' when none.
export function fixCommitOf(issue, merged = () => '') {
  for (const comment of [...(issue.comments || [])].reverse()) {
    const body = String(comment.body || '');
    for (const pattern of FIX_WORDS) { const hit = pattern.exec(body); if (hit && SHA.test(hit[1])) return hit[1]; }
    const pr = PR.exec(body);
    if (pr) { const sha = merged(Number(pr[1])); if (sha) return sha; }
  }
  return '';
}

// -> {stale, fix, status}. `compare(base, head)` returns the compare API's status ("ahead", "behind", "identical", "diverged") or ''.
export function staleSighting({issue, tested, compare, merged = () => ''}) {
  const fix = fixCommitOf(issue, merged);
  if (!fix || !tested) return {stale: false, fix, status: ''};
  let status = '';
  try { status = compare(fix, tested) || ''; } catch { status = ''; }
  // tested is "behind" the fix: it was built before the fix landed. Anything else (ahead, identical, diverged, unknown) counts as a regression.
  return {stale: status === 'behind', fix, status};
}

export const staleComment = (issue, {fix, tested}, runUrl) =>
  `Seen again in ${runUrl} on build \`${tested}\`, which was built **before** the fix \`${String(fix).slice(0, 7)}\` that closed this issue. A stale sighting, not a regression: not filed again. It becomes a regression only if it shows on a build that contains the fix.`;

// A suite that cannot run because its secrets are missing must not look like a pass (5 Oct 2026: two suites "passed" in 20 seconds
// without starting). Three behaviours, one place:
// - E2E_REQUIRE_SECRETS=1 (CI on this repo, release gates): a skipped suite exits 1, a failure.
// - run-all.mjs sets E2E_SKIP_EXIT=3: the suite exits 3, and the table says "skipped", not "✓".
// - otherwise (a fork's pull request, a bare `node suite.mjs`): exit 0 as before, with a warning line that says SKIPPED.
export const SKIPPED = 3;

export const skipExitCode = (env = process.env) => env.E2E_REQUIRE_SECRETS === '1' ? 1 : Number(env.E2E_SKIP_EXIT) || 0;

export const skipMessage = (name, missing) => `⚠ SKIPPED, nothing ran: the ${name} suite needs ${missing.join(' and ')} (set in the environment or the Keychain). This is not a pass.`;

// One row per suite, the totals line and the exit code of run-all. requireSecrets: a skipped suite counts as a failure.
export function summarize(results, {parallel = 1, requireSecrets = false} = {}) {
  const mark = r => r.code === 0 ? '✓' : r.code === SKIPPED ? '–' : '✗';
  const note = r => r.code === 0 ? '' : r.code === SKIPPED ? '   (skipped: secrets not set)' : `   (artifacts/${r.suite}${parallel > 1 ? '.run.log' : ''})`;
  const rows = results.map(r => `${mark(r)} ${r.suite.padEnd(12)} ${String(r.seconds).padStart(4)} s${note(r)}`);
  const skipped = results.filter(r => r.code === SKIPPED), failed = results.filter(r => r.code !== 0 && r.code !== SKIPPED);
  const passed = results.length - failed.length - skipped.length;
  const line = `${passed} passed, ${failed.length} failed${skipped.length ? `, ${skipped.length} skipped (not run)` : ''}`;
  return {text: `${rows.join('\n')}\n\n${line}`, exit: failed.length || (requireSecrets && skipped.length) ? 1 : 0};
}

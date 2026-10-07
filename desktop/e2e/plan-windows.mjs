// What the Windows e2e (e2e-windows.yml) runs. In the release run (desktop.yml, "Test · Windows") the Mac + Linux gate's suites, named (ONLY) with its review.
// After a scheduled Mac run (e2e.yml, job "Windows follows"), when it tested something: the same suites
// on the same commit, with the AI screenshot review where the Mac run had it, so Windows has the Mac's coverage (4 Oct 2026: it ran 7 of 13
// suites, weekly). A commit Windows already tested is not run again (the Mac looks at an unchanged commit up to three times; Windows once).
//   node plan-windows.mjs     (GH_TOKEN, REPO, MAC_RUN, SHA, REVIEW from e2e.yml; or ONLY=<suites> for a run by hand) -> GITHUB_OUTPUT lines
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const NOT_SUITES = new Set(['plan', 'promote', 'promote-dry-run', 'Windows follows']);

// The Mac run's jobs -> the suites that ran there (not skipped or cancelled).
export function macSuites(jobs) {
  return [...new Set(jobs.filter(job => !NOT_SUITES.has(job.name) && !['skipped', 'cancelled'].includes(job.conclusion))
    .map(job => job.name.replace(/ \(.*\)$/, '')))].sort();
}

// Earlier Windows runs (title "Windows <sha>") that already tested this commit: finished, not cancelled, with at least one suite run.
export const testedBefore = (runs, sha, current) => runs.filter(run => String(run.id) !== String(current) && run.title === `Windows ${sha}`
  && ['success', 'failure'].includes(run.conclusion) && run.suitesRan > 0);

export function plan({only = '', all = [], mac = null, sha = '', review = false, previous = []}) {
  // Named suites: by hand (no review asked), or the release run's Windows gate, which passes the Mac + Linux gate's suites and its review (7 Oct 2026).
  if (only.trim()) return {suites: only.split(',').map(name => name.trim()).filter(Boolean), review};
  if (!mac) return {suites: all, review: false};
  if (previous.length) return {suites: [], review: false, why: `commit ${sha.slice(0, 7)} was already tested on Windows (run ${previous[0].id}): nothing new to run`};
  return {suites: macSuites(mac.jobs || []), review};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const gh = args => execFileSync('gh', args, {encoding: 'utf8'});
  const all = JSON.parse(execFileSync(process.execPath, ['suite.mjs', '--list'], {encoding: 'utf8'})).include.map(item => item.suite);
  const {MAC_RUN: id, SHA: sha = '', REPO: repo} = process.env;
  let mac = null, previous = [];
  if (id && !process.env.ONLY) {
    mac = {jobs: JSON.parse(gh(['api', `repos/${repo}/actions/runs/${id}/jobs?per_page=100`, '--jq', '.jobs']))};
    const runs = JSON.parse(gh(['run', 'list', '--repo', repo, '--workflow', 'e2e-windows.yml', '--limit', '50', '--json', 'databaseId,displayTitle,conclusion']))
      .filter(run => run.displayTitle === `Windows ${sha}` && String(run.databaseId) !== String(process.env.GITHUB_RUN_ID));
    previous = testedBefore(runs.map(run => ({id: run.databaseId, title: run.displayTitle, conclusion: run.conclusion,
      suitesRan: JSON.parse(gh(['api', `repos/${repo}/actions/runs/${run.databaseId}/jobs?per_page=100`, '--jq', '[.jobs[] | select(.name != "plan" and .conclusion != "skipped" and .conclusion != "cancelled")] | length']))})), sha, process.env.GITHUB_RUN_ID);
  }
  const result = plan({only: process.env.ONLY || '', all, mac, sha, review: process.env.REVIEW === '1', previous});
  console.error(result.why || `Windows runs ${result.suites.length} suite(s)${mac ? ` after Mac run ${id}, commit ${sha.slice(0, 7)}` : ''}: ${result.suites.join(', ') || 'none'}; AI review: ${result.review ? 'yes' : 'no'}`);
  console.log(`matrix=${JSON.stringify({suite: result.suites})}`);
  console.log(`count=${result.suites.length}`);
  console.log(`review=${result.review ? '1' : '0'}`);
}

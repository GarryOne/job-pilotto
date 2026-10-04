// What the Windows e2e (e2e-windows.yml) runs after a Mac e2e run (e2e.yml): the same suites on the same commit, with the AI screenshot review
// where the Mac run had it, so Windows has the Mac's coverage (4 Oct 2026: it ran 7 of 13 suites, weekly). Runs after the Mac run, never beside
// it: each suite owns one Notion page. A stable canary or a release-candidate soak (an old tag) is not repeated on Windows.
//   node plan-windows.mjs            (GH_TOKEN, REPO, MAC_RUN, MAC_TITLE, MAC_CONCLUSION; or ONLY=<suites> for a run by hand) -> GITHUB_OUTPUT lines
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const STEP_REVIEW = 'AI review of the screenshots';
const NOT_SUITES = new Set(['plan', 'promote', 'promote-dry-run']);

// The Mac run's jobs -> {suites, review}: every suite job that ran (not skipped), and whether any of them had the AI review step.
export function fromMacJobs(jobs) {
  const ran = jobs.filter(job => !NOT_SUITES.has(job.name) && job.conclusion !== 'skipped' && job.conclusion !== 'cancelled');
  const suites = [...new Set(ran.map(job => job.name.replace(/ \(.*\)$/, '')))].sort();
  const review = ran.some(job => (job.steps || []).some(step => step.name === STEP_REVIEW && !['skipped', null, undefined].includes(step.conclusion)));
  return {suites, review};
}

// Whether a Mac run is one Windows follows: a finished run of the main journey, not a canary or a soak of an old tag.
export const follows = ({title = '', conclusion = ''}) => !/^(Stable canary|RC soak)\b/.test(title) && ['success', 'failure'].includes(conclusion);

export function plan({only = '', all = [], mac = null}) {
  if (only.trim()) return {suites: only.split(',').map(name => name.trim()).filter(Boolean), review: false};
  if (!mac) return {suites: all, review: false};
  if (!follows(mac)) return {suites: [], review: false, why: `not followed on Windows: ${mac.title || '?'} (${mac.conclusion || '?'})`};
  return fromMacJobs(mac.jobs || []);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const all = JSON.parse(execFileSync(process.execPath, ['suite.mjs', '--list'], {encoding: 'utf8'})).include.map(item => item.suite);
  const id = process.env.MAC_RUN;
  const mac = id ? {title: process.env.MAC_TITLE, conclusion: process.env.MAC_CONCLUSION,
    jobs: JSON.parse(execFileSync('gh', ['api', '--paginate', `repos/${process.env.REPO}/actions/runs/${id}/jobs?per_page=100`, '--jq', '.jobs'], {encoding: 'utf8'})
      .replace(/\]\s*\[/g, ','))} : null;
  const result = plan({only: process.env.ONLY || '', all, mac});
  console.error(result.why || `Windows runs ${result.suites.length} suite(s)${mac ? ` after Mac run ${id}` : ''}: ${result.suites.join(', ') || 'none'}; AI review: ${result.review ? 'yes' : 'no'}`);
  console.log(`matrix=${JSON.stringify({suite: result.suites})}`);
  console.log(`count=${result.suites.length}`);
  console.log(`review=${result.review ? '1' : '0'}`);
}

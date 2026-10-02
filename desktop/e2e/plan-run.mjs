// What a run of .github/workflows/e2e.yml does, decided in one place and printed as step outputs (matrix, count, ref, tag, review):
//   node plan-run.mjs >> "$GITHUB_OUTPUT"      (env: EVENT, REPO, SHA, BEFORE, RUN_HEAD_SHA, RUN_CONCLUSION, RUN_EVENT, ONLY, PROMOTE_TAG; needs `gh` and GH_TOKEN)
// schedule: every suite, unless nothing changed since the last run and no finding waits. push: the suites whose files changed. manual: the ones named.
// workflow_run (after the nightly build): every suite, on the build's own commit, and `tag` = the release to promote when all of them pass.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {autoSuites, reviewNeeded, shouldSkipScheduled, suitesFor, suitesNamed, waitingFindings} from './lib/plan.mjs';

const realGh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});

// all: every suite; cadence / watches: what each suite exports (lib/plan.mjs says what they mean).
export async function planRun({env, gh = realGh, all, minutes, cadence = {}, watches = {}}) {
  const {EVENT: event, REPO: repo, SHA: sha} = env;
  const ref = event === 'workflow_run' ? env.RUN_HEAD_SHA : sha;
  const lines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const changed = (from, to) => { try { return lines(gh(['api', `repos/${repo}/compare/${from}...${to}`, '--paginate', '-q', '.files[].filename'])); } catch { return null; } };
  const json = args => { try { return JSON.parse(gh(args)); } catch { return []; } };

  const runs = json(['run', 'list', '-R', repo, '--workflow', 'e2e.yml', '--status', 'completed', '-L', '30', '--json', 'event,headSha,conclusion']);
  const lastSha = runs.find(run => run.event !== 'push' && ['success', 'failure'].includes(run.conclusion))?.headSha || '';
  const waiting = waitingFindings(json(['issue', 'list', '-R', repo, '--label', 'auto-ui', '--state', 'open', '--limit', '300', '--json', 'number,state,labels,body,comments']));

  let suites = [], tag = '';
  if (event === 'push') suites = suitesFor(changed(env.BEFORE, sha) || ['desktop/e2e/suite.mjs'], all, {watches, cadence});
  else if (event === 'workflow_run') {
    if (env.RUN_CONCLUSION === 'success' && env.RUN_EVENT === 'schedule') {   // only the nightly build: one started by hand is for trying
      // The build made a release of this very commit? (A nightly with nothing new builds nothing, and then there is nothing to verify.)
      for (const {tagName} of json(['release', 'list', '-R', repo, '-L', '5', '--exclude-drafts', '--json', 'tagName'])) {
        let built = '';
        try { built = gh(['api', `repos/${repo}/commits/${tagName}`, '-q', '.sha']).trim(); } catch { /* an unreadable tag is not it */ }
        if (built === ref) { tag = tagName; break; }
      }
      if (tag) suites = autoSuites(all, cadence);   // the nightly gate: always + nightly suites, not the manual ones
    }
  } else if (env.PROMOTE_TAG) suites = [];   // a manual dry run of the promotion step: no suites
  else if (event === 'schedule') suites = shouldSkipScheduled({event, head: ref, lastSha, waiting}) ? [] : autoSuites(all, cadence, true);   // the three-a-day schedule: the always suites
  else suites = String(env.ONLY || '').trim() ? suitesNamed(env.ONLY, all) : autoSuites(all, cadence);   // names: exactly those, even a manual one; none: everything not manual

  const files = lastSha ? changed(lastSha, ref) : null;
  const review = reviewNeeded({files: files || [], waiting, known: files !== null});
  const include = [];
  for (const suite of suites) include.push({suite, minutes: await minutes(suite)});
  return {matrix: JSON.stringify({include}), count: String(include.length), ref, tag, review: review ? '1' : '0'};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const {SUITES} = await import('./lib/context.mjs');
  const cadence = {}, watches = {};
  for (const suite of SUITES) { const module = await import(`./suites/${suite}.mjs`); if (module.cadence) cadence[suite] = module.cadence; if (module.watches) watches[suite] = module.watches; }
  const out = await planRun({env: process.env, all: SUITES, cadence, watches, minutes: async suite => (await import(`./suites/${suite}.mjs`)).minutes || 15});
  for (const [key, value] of Object.entries(out)) console.log(`${key}=${value}`);
  const summary = `Suites: ${JSON.parse(out.matrix).include.map(item => item.suite).join(', ') || '(none)'} · commit ${String(out.ref).slice(0, 7)}${out.tag ? ` · promotes ${out.tag} when all pass` : ''} · AI review ${out.review === '1' ? 'on' : 'off'}`;
  console.error(summary);
}

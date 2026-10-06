// What a run of .github/workflows/e2e.yml does, decided in one place and printed as step outputs (matrix, count, ref, tag, review):
//   node plan-run.mjs >> "$GITHUB_OUTPUT"      (env: EVENT, REPO, SHA, BEFORE, RUN_HEAD_SHA, RUN_CONCLUSION, RUN_EVENT, ONLY, PROMOTE_TAG; needs `gh` and GH_TOKEN)
// schedule: every suite, unless nothing changed since the last run and no finding waits. push: the suites whose files changed. manual: the ones named.
// workflow_run (after the nightly build): every suite, on the build's own commit, and `tag` = the release to promote when all of them pass.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {autoSuites, exploreDecision, noiseTripped, reviewNeeded, suitesFor, suitesNamed, waitingFindings} from './lib/plan.mjs';
import {asIssues, REGISTER_LIST, registerEntries} from './lib/prejudge.mjs';

const realGh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});

// all: every suite; cadence / watches: what each suite exports (lib/plan.mjs says what they mean).
export async function planRun({env, gh = realGh, all, minutes, cadence = {}, watches = {}, varies = []}) {
  const {EVENT: event, REPO: repo, SHA: sha} = env;
  // TARGET_REF (a manual run of the soak top-ups and the stable canary): test THAT release's commit, with this workflow file. The workflow file of an old tag does not know newer
  // inputs (canary, soak), so the run is started on main and told which tag to check out.
  let target = '';
  if (event === 'workflow_dispatch' && env.TARGET_REF) {
    try { target = gh(['api', `repos/${repo}/commits/${env.TARGET_REF}`, '-q', '.sha']).trim(); } catch { throw new Error(`target_ref ${env.TARGET_REF} is not a commit of ${repo}`); }
  }
  const ref = event === 'workflow_run' ? env.RUN_HEAD_SHA : target || sha;
  const lines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const changed = (from, to) => { try { return lines(gh(['api', `repos/${repo}/compare/${from}...${to}`, '--paginate', '-q', '.files[].filename'])); } catch { return null; } };
  const json = args => { try { return JSON.parse(gh(args)); } catch { return []; } };

  const runs = json(['run', 'list', '-R', repo, '--workflow', 'e2e.yml', '--status', 'completed', '-L', '60', '--json', 'event,headSha,conclusion,createdAt,displayTitle']);
  const lastSha = runs.find(run => run.event !== 'push' && ['success', 'failure'].includes(run.conclusion))?.headSha || '';
  const issues = json(['issue', 'list', '-R', repo, '--label', 'auto-ui', '--state', 'open', '--limit', '300', '--json', 'number,state,labels,body,comments,createdAt']);
  const waiting = waitingFindings(issues);
  // Runs of main's code on this commit (a gate run, a release candidate's top-up or the stable canary tests another commit under main's name: not these).
  const own = run => run.headSha === ref && run.event !== 'push' && run.event !== 'workflow_run' && !/^(Stable canary|RC soak|Gate) /.test(run.displayTitle || '');
  let exploring = false, why = '';

  let suites = [], tag = '';
  if (event === 'push') suites = suitesFor(changed(env.BEFORE, sha) || ['desktop/e2e/suite.mjs'], all, {watches, cadence});
  else if (event === 'workflow_run') {
    // The nightly build: the schedule's own run, or the one the Worker's cron started on time (named Nightly build, worker/src/scheduler.js). A beta by hand (named Beta build,
    // desktop.yml -f beta=true) is gated the same way. Any other build started by hand is for trying.
    if (env.RUN_CONCLUSION === 'success' && (env.RUN_EVENT === 'schedule' || /^(Nightly|Beta) build$/.test(env.RUN_TITLE || ''))) {
      // The build made a release of this very commit? (A nightly with nothing new builds nothing, and then there is nothing to verify.)
      for (const {tagName} of json(['release', 'list', '-R', repo, '-L', '5', '--exclude-drafts', '--json', 'tagName'])) {
        let built = '';
        try { built = gh(['api', `repos/${repo}/commits/${tagName}`, '-q', '.sha']).trim(); } catch { /* an unreadable tag is not it */ }
        if (built === ref) { tag = tagName; break; }
      }
      if (tag) suites = autoSuites(all, cadence);   // the nightly gate: always + nightly suites, not the manual ones
    }
  } else if (env.PROMOTE_TAG) suites = [];   // a manual dry run of the promotion step: no suites
  else if (event === 'workflow_dispatch' && env.GATE_TAG) { tag = env.GATE_TAG; suites = autoSuites(all, cadence); }   // the gate for one tag, by hand: the same suites as the nightly gate, on that tag's commit, and the promote job follows
  else if (event === 'schedule') {   // the three-a-day schedule: the always suites, on a new commit, for a finding that waits, or while exploring still finds something
    const decision = exploreDecision({head: ref, lastSha, runsOnHead: runs.filter(own)});
    exploring = decision.exploring; why = decision.why;
    // Exploring (an unchanged commit): only the suites that walk a different path each run; the others would repeat themselves at full cost. None vary: nothing to explore.
    suites = !decision.run ? [] : decision.exploring ? autoSuites(all, cadence, true).filter(suite => varies.includes(suite)) : autoSuites(all, cadence, true);
  }
  else suites = String(env.ONLY || '').trim() ? suitesNamed(env.ONLY, all) : autoSuites(all, cadence);   // names: exactly those, even a manual one; none: everything not manual

  const files = lastSha ? changed(lastSha, ref) : null;
  let review = exploring || reviewNeeded({files: files || [], waiting, known: files !== null});   // an exploring run exists for what the AI review sees
  if (review) {   // the noise breaker: no AI tokens on a review whose recent issues were mostly noise
    try {
      const issues = JSON.parse(gh(['issue', 'list', '--label', 'auto-ui', '--state', 'all', '--limit', '300', '--json', 'number,state,stateReason,labels,comments,createdAt']));
      // Noise judged before filing never became an issue: it still counts against the review (lib/prejudge.mjs asIssues).
      const judged = asIssues(registerEntries(JSON.parse(gh(REGISTER_LIST))[0]?.body));
      const noise = noiseTripped([...issues, ...judged]);
      if (noise.tripped) { review = false; why = `${why ? `${why} · ` : ''}AI review paused: ${noise.noise} of the last ${noise.judged} judged review issues were noise (the noise breaker, lib/plan.mjs)`; }
    } catch { /* cannot tell: the review runs */ }
  }
  const include = [];
  for (const suite of suites) include.push({suite, minutes: await minutes(suite)});
  return {matrix: JSON.stringify({include}), count: String(include.length), ref, tag, review: review ? '1' : '0', why};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const {SUITES} = await import('./lib/context.mjs');
  const cadence = {}, watches = {}, varies = [];
  for (const suite of SUITES) { const module = await import(`./suites/${suite}.mjs`); if (module.cadence) cadence[suite] = module.cadence; if (module.watches) watches[suite] = module.watches; if (module.varies) varies.push(suite); }
  const out = await planRun({env: process.env, all: SUITES, cadence, watches, varies, minutes: async suite => (await import(`./suites/${suite}.mjs`)).minutes || 15});
  for (const [key, value] of Object.entries(out)) console.log(`${key}=${value}`);
  const summary = `Suites: ${JSON.parse(out.matrix).include.map(item => item.suite).join(', ') || '(none)'} · commit ${String(out.ref).slice(0, 7)}${out.tag ? ` · promotes ${out.tag} when all pass` : ''} · AI review ${out.review === '1' ? 'on' : 'off'}`;
  console.error(out.why ? `${summary} · ${out.why}` : summary);
}

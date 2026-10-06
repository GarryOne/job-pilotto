// Runs a suite's steps: names, timings, a screenshot on the first failure, a summary, an exit code. Steps that need a secret that is not there are skipped, loudly.
import {ARTIFACTS} from './app.mjs';
import {isEnvironment, RETRY_WAIT_MS} from './environment.mjs';
import {faultCheck, NEVER_FIRED, neverFiredNote} from './faults.mjs';

// keepGoing (a suite's `export const keepGoing = true`): a failed step is recorded and the next one runs, so one failure never hides the rest of the suite
// (5 Oct 2026: one outdated step hid fifteen, twice). A step marked `critical` (the setup the others need) still stops the suite.
// A step that never ends (6 Oct 2026: activityfailures sat 25 min after its first step, killed by the job's timeout with no screenshot and no app log: a call into the
// app that never answered). Every step gets a limit (limitMs, default 8 min: twice the longest step of the 6 Oct gate, 226 s); past it the step fails like any other, saving the
// screenshot and logs, with which side of the app still answers in the message.
export const STEP_LIMIT_MS = Number(process.env.E2E_STEP_LIMIT_MS) || 8 * 60000;
const answers = (promise, ms = 5000) => Promise.race([promise.then(() => true, () => false), new Promise(done => setTimeout(() => done(false), ms))]);
export async function hangReport(session) {
  if (!session) return 'no app session';
  const [window, main] = await Promise.all([answers(session.page?.evaluate(() => 1) ?? Promise.reject()), answers(session.app?.evaluate(() => 1) ?? Promise.reject())]);
  return `the window ${window ? 'answers' : 'does NOT answer'}, the main process ${main ? 'answers' : 'does NOT answer'}`;
}
export function withLimit(promise, ms, name, getSession = () => null, budget = 0) {   // budget: set when the suite's budget, not the step's own limit, is what cuts it
  let timer;
  const limit = new Promise((_, fail) => { timer = setTimeout(async () => fail(new Error(budget
    ? `the suite's ${Math.round(budget / 60000)}-minute budget ran out during this step (the suite is too long: split it): ${await hangReport(getSession())}`
    : `the step did not finish within ${Math.round(ms / 60000)} min (it hung): ${await hangReport(getSession())}`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// E2E_STEPS=<words> runs only the steps whose name contains one; `stepNeeds` (a suite's export: {'step name words': ['words of a step it needs', ...]}) adds the
// steps a chosen one depends on, transitively (6 Oct 2026: a filtered run lacked the earlier step that opened Settings, made the second run, set the proxy up...).
export function wantedWords(words, stepNeeds = {}) {
  const wanted = new Set(words.map(word => word.toLowerCase()));
  for (let grew = true; grew;) {
    grew = false;
    for (const [step, needs] of Object.entries(stepNeeds)) {
      if (![...wanted].some(word => step.toLowerCase().includes(word))) continue;
      for (const need of needs) if (!wanted.has(need.toLowerCase())) { wanted.add(need.toLowerCase()); grew = true; }
    }
  }
  return [...wanted];
}

// A whole suite has a budget too (owner, 6 Oct 2026: no suite over 5-7 minutes). Past it, the steps left are recorded as not run and the suite fails, naming its
// slowest steps; a running step is cut at the budget's end. A suite that truly needs more says so (`export const budgetMinutes`), only for manual suites.
export const SUITE_BUDGET_MS = Number(process.env.E2E_SUITE_BUDGET_MS) || 7 * 60000;
export const slowest = (results, count = 5) => results.filter(result => result.seconds).sort((a, b) => b.seconds - a.seconds).slice(0, count).map(result => `${result.name.slice(0, 70)} (${Math.round(result.seconds)} s)`);

// The screenshot a failed step leaves (without .png); the step summary names it (lib/step-summary.mjs).
export const shotName = name => `failed-${name.replace(/\W+/g, '-').slice(0, 60)}`;

// faultTally: () => the fakes' {armed, failed} counters (lib/faults.mjs), to check that a step's fault fired.
export function createRunner(getSession, {keepGoing = false, budgetMs = SUITE_BUDGET_MS, stepNeeds = {}, faultTally = null} = {}) {
  const results = [], suiteStarted = Date.now();
  let overBudget = false;
  async function run(name, rawFn, {needs = [], faults = false, critical = false, limitMs = STEP_LIMIT_MS} = {}) {
    const left = budgetMs - (Date.now() - suiteStarted);
    if (left <= 0) {
      if (!overBudget) console.log(`✗ the suite is over its ${Math.round(budgetMs / 60000)}-minute budget; slowest steps: ${slowest(results).join('; ')}`);
      overBudget = true;
      results.push({name, status: 'failed', note: `not run: the suite was over its ${Math.round(budgetMs / 60000)}-minute budget`, budget: true});
      return;
    }
    const fn = () => withLimit(Promise.resolve().then(rawFn), Math.min(limitMs, left), name, getSession, left < limitMs ? budgetMs : 0);   // faults: the step breaks things on purpose, so a broken answer is the product's to handle: never retried, never "environment"
    // E2E_STEPS=tailor,seeded runs only the steps whose name contains one of these words (and the critical setup): a quick way to re-run one step of a long suite.
    const only = wantedWords((process.env.E2E_STEPS || '').split(',').map(word => word.trim()).filter(Boolean), stepNeeds);
    if (only.length && !critical && !only.some(word => name.toLowerCase().includes(word))) return;
    const missing = needs.filter(item => !item.value);
    if (missing.length) { results.push({name, status: 'skipped'}); console.log(`- ${name}: skipped (needs ${missing.map(item => item.name).join(', ')})`); return; }
    const started = Date.now(), before = faultTally?.();
    const unfired = () => faultCheck(before, faultTally?.(), {faults});
    let retried = '';
    await getSession()?.traceGroup?.(name);   // the step's actions sit under its name in the trace (lib/app.mjs)
    try {
      try { await fn(); } catch (error) {
        // The environment answered badly (an HTML error page, a dropped connection): one more try before it counts (#266).
        if (faults || !isEnvironment(error.message)) throw error;
        retried = String(error.message).slice(0, 200);
        console.log(`↻ ${name}: the environment failed (${retried.slice(0, 120)}), trying once more`);
        await new Promise(done => setTimeout(done, RETRY_WAIT_MS));
        await fn();
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const vacuous = unfired();
      results.push({name, status: 'passed', seconds, ...(retried ? {retried} : {}), ...(vacuous ? {faultNeverFired: true} : {})});
      console.log(`✓ ${name} (${seconds}s)${retried ? ' after one retry' : ''}${vacuous ? ` ⚠ passed, but ${NEVER_FIRED}: it may test nothing` : ''}`);
    } catch (error) {
      await getSession()?.shot(shotName(name));
      await getSession()?.keepLogs();   // the app's and the engine's own logs: a screenshot says "nothing new", the log says why
      const note = unfired() ? `${error.message} ${neverFiredNote}` : error.message;
      results.push({name, status: 'failed', note, ...(!faults && isEnvironment(error.message) ? {environment: true} : {}), ...(note !== error.message ? {faultNeverFired: true} : {})});
      console.log(`✗ ${name}: ${note}`);
      if (keepGoing && !critical) return;   // recorded: the suite still fails at the end, and the next step runs
      throw error;
    } finally { await getSession()?.traceGroupEnd?.(); }
  }
  const summary = () => {
    const count = status => results.filter(result => result.status === status).length;
    console.log(`\n${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped`);
    return count('failed') ? 1 : 0;
  };
  return {run, results, summary, ARTIFACTS};
}

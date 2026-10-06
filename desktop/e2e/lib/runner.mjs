// Runs a suite's steps: names, timings, a screenshot on the first failure, a summary, an exit code. Steps that need a secret that is not there are skipped, loudly.
import {ARTIFACTS} from './app.mjs';
import {isEnvironment, RETRY_WAIT_MS} from './environment.mjs';

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
export function withLimit(promise, ms, name, getSession = () => null) {
  let timer;
  const limit = new Promise((_, fail) => { timer = setTimeout(async () => fail(new Error(`the step did not finish within ${Math.round(ms / 60000)} min (it hung): ${await hangReport(getSession())}`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

export function createRunner(getSession, {keepGoing = false} = {}) {
  const results = [];
  async function run(name, rawFn, {needs = [], faults = false, critical = false, limitMs = STEP_LIMIT_MS} = {}) {
    const fn = () => withLimit(Promise.resolve().then(rawFn), limitMs, name, getSession);   // faults: the step breaks things on purpose, so a broken answer is the product's to handle: never retried, never "environment"
    // E2E_STEPS=tailor,seeded runs only the steps whose name contains one of these words (and the critical setup): a quick way to re-run one step of a long suite.
    const only = (process.env.E2E_STEPS || '').split(',').map(word => word.trim().toLowerCase()).filter(Boolean);
    if (only.length && !critical && !only.some(word => name.toLowerCase().includes(word))) return;
    const missing = needs.filter(item => !item.value);
    if (missing.length) { results.push({name, status: 'skipped'}); console.log(`- ${name}: skipped (needs ${missing.map(item => item.name).join(', ')})`); return; }
    const started = Date.now();
    let retried = '';
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
      results.push({name, status: 'passed', seconds, ...(retried ? {retried} : {})});
      console.log(`✓ ${name} (${seconds}s)${retried ? ' after one retry' : ''}`);
    } catch (error) {
      await getSession()?.shot(`failed-${name.replace(/\W+/g, '-').slice(0, 60)}`);
      await getSession()?.keepLogs();   // the app's and the engine's own logs: a screenshot says "nothing new", the log says why
      results.push({name, status: 'failed', note: error.message, ...(!faults && isEnvironment(error.message) ? {environment: true} : {})});
      console.log(`✗ ${name}: ${error.message}`);
      if (keepGoing && !critical) return;   // recorded: the suite still fails at the end, and the next step runs
      throw error;
    }
  }
  const summary = () => {
    const count = status => results.filter(result => result.status === status).length;
    console.log(`\n${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped`);
    return count('failed') ? 1 : 0;
  };
  return {run, results, summary, ARTIFACTS};
}

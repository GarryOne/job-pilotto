// Runs a suite's steps: names, timings, a screenshot on the first failure, a summary, an exit code. Steps that need a secret that is not there are skipped, loudly.
import {ARTIFACTS} from './app.mjs';

export function createRunner(getSession) {
  const results = [];
  async function run(name, fn, {needs = []} = {}) {
    const missing = needs.filter(item => !item.value);
    if (missing.length) { results.push({name, status: 'skipped'}); console.log(`- ${name}: skipped (needs ${missing.map(item => item.name).join(', ')})`); return; }
    const started = Date.now();
    try {
      await fn();
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      results.push({name, status: 'passed', seconds});
      console.log(`✓ ${name} (${seconds}s)`);
    } catch (error) {
      await getSession()?.shot(`failed-${name.replace(/\W+/g, '-').slice(0, 60)}`);
      await getSession()?.keepLogs();   // the app's and the engine's own logs: a screenshot says "nothing new", the log says why
      results.push({name, status: 'failed', note: error.message});
      console.log(`✗ ${name}: ${error.message}`);
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

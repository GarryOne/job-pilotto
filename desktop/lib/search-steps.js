// Owns: the steps of one "Find jobs" run (the search task): the first run's order (jobs in seconds: a slice of fast feeds, 3 scored, then the rest), the usual
// order (job boards, then the employers' pages), and the employer finder (the scout) at the end when it is due, so one action grows the sources and crawls them.
// Guarded by: test/search-steps.test.js, test/app-scenarios.test.js. Spec: docs/superpowers/specs/2026-10-16-first-jobs-fast.md.
import * as claudeCode from './claude-code.js';
import {dailyArgs, SCOUT_BUDGET_S, deliveryReady, triggerEnv} from './pipeline-args.js';
import {run} from './pipeline-run.js';

const SCOUT_COOLDOWN_MS = 24 * 3600 * 1000;   // a press of Find jobs grows the sources at most once a day

// The employer finder is part of Find jobs: on the first run, and on a press when none ran in the last day. A schedule that has its own scout
// (Settings → How often) keeps it separate.
export function scoutDue(settings, trigger, now = Date.now(), force = false) {
  if (force) return true;   // "Find more employers" from the few-jobs help or the next-step advice
  if (trigger === 'schedule' || settings.cloud?.repo) return false;
  if (trigger === 'first' || !settings.lastScoutAt) return true;
  return now - Date.parse(settings.lastScoutAt) >= SCOUT_COOLDOWN_MS;
}

// A Find jobs press on a Mac that never searched is the first run (jobs in seconds), whoever pressed: the card, the header button, ⌘K.
export const searchTrigger = settings => (settings.lastSearchAt ? 'you' : 'first');

export async function searchSteps(storage, onLine, mode, trigger = 'you', exec = run, {employers = false} = {}) {
  const ai = claudeCode.aiReady(storage.settings(), !!storage.secret('ANTHROPIC_API_KEY'), !!storage.secret('OPENAI_API_KEY'));
  const env = triggerEnv(trigger);
  let code;
  let result;
  if (trigger === 'first' && ai) {
    // The first run: jobs in seconds. The engine reads a slice of fast feeds and scores 3 jobs first (src/first_jobs.py), then does the full search;
    // the job boards come after it, and the jobs they find are scored by a light run (mode today), so nothing in front of the first job waits for them.
    onLine('Finding your first jobs…');
    ({code, result} = await exec(storage, dailyArgs(storage, {mode, firstJobs: true}), onLine, env));
    onLine('Searching job boards…');
    await exec(storage, ['src', 'discover', '--pages', '5', '--max-companies', '40'], onLine);
    await exec(storage, dailyArgs(storage, {mode: 'today'}), onLine, env);
  } else {
    onLine('Searching job boards…');
    await exec(storage, ['src', 'discover', '--pages', '5', '--max-companies', '40'], onLine);
    onLine('Checking employer career pages' + (ai ? ', then reading and scoring new jobs…' : '…'));
    ({code, result} = await exec(storage, dailyArgs(storage, {mode}), onLine, env));
  }
  if (scoutDue(storage.settings(), trigger, Date.now(), employers)) {
    onLine('Growing your sources: finding more employers…');
    storage.saveSettings({lastScoutAt: new Date().toISOString()});
    await exec(storage, ['src', 'scout', ...(deliveryReady(storage) ? ['--send'] : []), '--log-run', '--budget', String(SCOUT_BUDGET_S)], onLine, env);
  }
  return {code, result};
}

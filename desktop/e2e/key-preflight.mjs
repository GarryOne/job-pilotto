// One check of the E2E AI key before a gate's whole matrix starts: a refused key or an empty credit balance stops the run with one line, not as ~60 red jobs (run 11, 23 Oct 2026).
import fs from 'node:fs';
import {checkKeyAccepted, checkOtherKeys} from './lib/key-check.mjs';

const key = process.env.E2E_ANTHROPIC_KEY || '';
const summary = line => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`); };
if (!key) { console.log('preflight: no E2E_ANTHROPIC_KEY here (a fork): nothing to check'); process.exit(0); }
try {
  await checkKeyAccepted({engine: 'api', key});
  await checkOtherKeys({engine: 'api'});   // the other family: a warning, never a stop
  console.log('preflight: the E2E AI key is accepted');
} catch (error) {
  summary(`### ❌ The E2E AI key is refused, so no suite was started\n\n${error.message}`);
  console.error(`::error::${error.message}`);
  process.exit(1);
}

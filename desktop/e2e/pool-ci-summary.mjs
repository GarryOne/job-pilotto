// node pool-ci-summary.mjs <smoke reports folder> [baseline file]: the CI pool run's job summary (.github/workflows/pool-smoke.yml) from the newest day report smoke.mjs wrote:
// the table on stdout (the workflow appends it to $GITHUB_STEP_SUMMARY), exit 1 when a row did not finish, the tripwire fired, the AI was refused or a row fell below
// its last CI run (the baseline file of pool-ci-state.mjs prepare; lib/pool-ci.mjs summary).
import fs from 'node:fs';
import path from 'node:path';
import {summary} from './lib/pool-ci.mjs';

const dir = process.argv[2] || '';
const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
if (!days.length) { console.log(`## Pool smoke ❌\n\nNo day report in ${dir || '(no folder given)'}: the run ended before its first row (read smoke.log in the artifact).`); process.exit(1); }
const baseline = (() => { try { return JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); } catch { return {}; } })();
// A PR's live proof (JOB_PILOTTO_VISIT_KIND=proof) that could not visit its row is not red: a reason outside the PR never blocks its merge; the NOT RUN line goes to the PR.
const {markdown, red, notRun} = summary(JSON.parse(fs.readFileSync(path.join(dir, days.at(-1)), 'utf8')), {baseline, proof: process.env.JOB_PILOTTO_VISIT_KIND === 'proof', keyName: process.env.AI_KEY_NAME || ''});
process.stdout.write(markdown);
if (notRun && process.env.NOT_RUN_FILE) fs.writeFileSync(process.env.NOT_RUN_FILE, `${notRun}\n`);   // the workflow comments it on the PR
process.exit(red.length ? 1 : 0);

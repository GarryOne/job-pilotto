// node pool-ci-summary.mjs <smoke reports folder>: the CI pool run's job summary (.github/workflows/pool-smoke.yml) from the newest day report smoke.mjs wrote:
// the table on stdout (the workflow appends it to $GITHUB_STEP_SUMMARY), exit 1 when a row did not finish or the privacy tripwire fired (lib/pool-ci.mjs summary).
import fs from 'node:fs';
import path from 'node:path';
import {summary} from './lib/pool-ci.mjs';

const dir = process.argv[2] || '';
const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
if (!days.length) { console.log(`## Pool smoke ❌\n\nNo day report in ${dir || '(no folder given)'}: the run ended before its first row (read smoke.log in the artifact).`); process.exit(1); }
const {markdown, red} = summary(JSON.parse(fs.readFileSync(path.join(dir, days.at(-1)), 'utf8')));
process.stdout.write(markdown);
process.exit(red.length ? 1 : 0);

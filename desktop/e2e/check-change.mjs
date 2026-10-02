// The guard before an automatic fix becomes a pull request: reads the changed file names (one per line, stdin) and exits 1 with the reason
// when any is outside what a UI fix may touch, or when the fix has no test.   git status --porcelain ... | node check-change.mjs
import fs from 'node:fs';
import {checkChange} from './lib/triage.mjs';

const files = fs.readFileSync(0, 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
const verdict = checkChange(files);
console.log(verdict.ok ? `ok: ${files.length} file(s)` : `refused: ${verdict.why}`);
process.exit(verdict.ok ? 0 : 1);

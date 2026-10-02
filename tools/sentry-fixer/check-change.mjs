// The guard before an automatic Sentry fix becomes a pull request: changed file names on stdin, one per line; exit 1 with the reason when any is out of bounds or there is no test.
import fs from 'node:fs';
import {checkChange} from './lib.mjs';

const files = fs.readFileSync(0, 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
const verdict = checkChange(files);
console.log(verdict.ok ? `ok: ${files.length} file(s)` : `refused: ${verdict.why}`);
process.exit(verdict.ok ? 0 : 1);

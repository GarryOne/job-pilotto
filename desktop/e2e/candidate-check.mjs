// The candidate recipe check as a command (learning loop, PR 2): node candidate-check.mjs <recipe.json> [--only <part of a case name>]. Fills every recorded form that holds the
// recipe's fingerprint with and without it (lib/candidate-check.mjs), prints the verdict as JSON; exit 0 = pass or no recorded form (said so), 1 = refused. Needs Chromium with the extension (CI: page-cases' install).
import fs from 'node:fs';
import {checkCandidate} from './lib/candidate-check.mjs';
import {loadCases} from './lib/page-replay.mjs';

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error('usage: node candidate-check.mjs <recipe.json> [--only <case name part>]'); process.exit(2); }
const only = rest[0] === '--only' ? rest[1] || '' : '';
const result = await checkCandidate(JSON.parse(fs.readFileSync(file, 'utf8')), {cases: loadCases().filter(item => item.name.includes(only))});
console.log(JSON.stringify(result, null, 1));
process.exit(result.verdict === 'refused' ? 1 : 0);

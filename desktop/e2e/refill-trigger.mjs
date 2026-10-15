// The automatic refill's first question (.github/workflows/replay-refill.yml, a push to main): did this merge change any ladder prompt fingerprint? Prints "changed" or "same".
//   node refill-trigger.mjs <ladder-baseline.json before the merge | -> <ladder-baseline.json now>      (a score update alone changes the file, not the fingerprint: "same"). Guard: e2e/test/refill.test.mjs.
import fs from 'node:fs';
import {fingerprintChanged} from './lib/refill.mjs';

const [beforeFile, afterFile] = process.argv.slice(2), read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
if (!beforeFile || !afterFile) { console.error('usage: node refill-trigger.mjs <baseline before | -> <baseline now>'); process.exit(2); }
console.log(fingerprintChanged(beforeFile === '-' ? null : read(beforeFile), read(afterFile)) ? 'changed' : 'same');

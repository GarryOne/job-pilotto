// npm run flows (in desktop/): the whole Applying scenario matrix (e2e/flows.mjs), unit rows then e2e rows, and on a full pass the record
// tools/flows-gate.mjs asks for before a push that changes a flow file: artifacts/flows-pass.json with the flow files' digest.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {MATRIX, flowDigest, matrixSteps, matrixUnits} from './flows.mjs';

const desktop = path.resolve(import.meta.dirname, '..'), root = path.resolve(desktop, '..');
const read = file => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
const before = flowDigest(read);
console.log(`flows: ${MATRIX.length} scenarios, ${matrixUnits().length} unit file(s), ${matrixSteps().length} e2e step(s); flow files ${before}`);
const unit = spawnSync(process.execPath, ['--test', ...matrixUnits()], {cwd: desktop, stdio: 'inherit'});
if (unit.status !== 0) { console.error('flows: unit rows failed'); process.exit(1); }
const e2e = spawnSync(process.execPath, ['run-all.mjs', '--only', 'apply'], {cwd: path.join(desktop, 'e2e'), stdio: 'inherit',
  env: {...process.env, E2E_STEPS: matrixSteps().join(',')}});
if (e2e.status !== 0) { console.error('flows: e2e rows failed'); process.exit(1); }
if (flowDigest(read) !== before) { console.error('flows: a flow file changed during the run: run it again'); process.exit(1); }
const out = path.join(desktop, 'e2e', 'artifacts', 'flows-pass.json');
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify({digest: before, at: new Date().toISOString(), scenarios: MATRIX.length, steps: matrixSteps()}, null, 1));
console.log(`flows: all ${MATRIX.length} scenarios passed; recorded for flow files ${before}`);

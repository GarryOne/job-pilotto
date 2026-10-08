// The Applying scenario matrix (e2e/flows.mjs, docs/flows/applying.md) stays true: every row's e2e words match a real step of the apply suite, every unit
// file exists, every flow file exists and the doc lists every scenario. A renamed step would otherwise drop its row from `npm run flows` without a word.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {FLOW_FILES, MATRIX, flowDigest} from '../e2e/flows.mjs';

const desktop = path.resolve(import.meta.dirname, '..'), root = path.resolve(desktop, '..');
const titles = [...fs.readFileSync(path.join(desktop, 'e2e/suites/apply.mjs'), 'utf8').matchAll(/ctx\.run\('((?:[^'\\]|\\.)*)'/g)].map(match => match[1].toLowerCase());

test('every matrix row is guarded by steps and tests that exist', () => {
  for (const row of MATRIX) {
    assert.ok(row.e2e.length + row.unit.length > 0, `"${row.scenario}" has no guard`);
    for (const words of row.e2e) assert.ok(titles.some(title => title.includes(words.toLowerCase())), `"${row.scenario}": no apply step matches "${words}"`);
    for (const file of row.unit) assert.ok(fs.existsSync(path.join(desktop, file)), `"${row.scenario}": ${file} is missing`);
  }
});

test('every flow file exists, and the doc names every scenario', () => {
  for (const file of FLOW_FILES) assert.ok(fs.existsSync(path.join(root, file)), `${file} is listed as flow code but missing`);
  const doc = fs.readFileSync(path.join(root, 'docs/flows/applying.md'), 'utf8');
  for (const row of MATRIX) assert.ok(doc.includes(row.scenario), `docs/flows/applying.md does not list "${row.scenario}"`);
});

test('the digest is of the flow files\' content: any change to one changes it', () => {
  const base = flowDigest(file => `content of ${file}`);
  assert.equal(flowDigest(file => `content of ${file}`), base);
  assert.notEqual(flowDigest(file => (file === FLOW_FILES[0] ? 'changed' : `content of ${file}`)), base);
});

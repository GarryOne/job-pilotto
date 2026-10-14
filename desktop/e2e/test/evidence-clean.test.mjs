// What the evidence folder keeps (lib/evidence-clean.mjs): end.png always, step pictures only of a row that needs a fix or is a site problem, day folders older than 14 days removed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {writeBundle, saveElectronLeg} from '../lib/evidence-bundle.mjs';
import {KEEP_DAYS, keepsSteps, removeOldEvidence} from '../lib/evidence-clean.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-clean-'));
function capture() {
  const dir = tmp();
  for (const name of ['end.png', 'step-01-posting.png', 'step-02-form.png']) fs.writeFileSync(path.join(dir, name), 'png');
  return dir;
}
const bundle = (run, extra = {}) => {
  const root = tmp(), dir = path.join(root, 'evidence'), captureDir = capture();
  saveElectronLeg({dir, day: '2026-10-14', shape: 'a/b', captureDir});
  const folder = writeBundle({dir, day: '2026-10-14', shape: 'a/b', result: run, captureDir, keepSteps: keepsSteps(run), ...extra});
  return {folder, files: fs.readdirSync(folder).filter(n => n.endsWith('.png')).sort(), electron: fs.readdirSync(path.join(folder, 'electron')).filter(n => n.endsWith('.png')).sort()};
};

test('a run that works or is held keeps end.png only; a run that needs a fix or is a site problem keeps its steps too', () => {
  const rows = {
    works: [{reached: 'form', filled: 5, left: 0}, ['end.png']],
    held: [{reached: 'account', note: 'account-first: held'}, ['end.png']],
    fix: [{reached: 'posting'}, ['end.png', 'step-01-posting.png', 'step-02-form.png']],
    site: [{reached: 'none', note: 'site refused: retry later'}, ['end.png', 'step-01-posting.png', 'step-02-form.png']]};
  for (const [name, [run, expected]] of Object.entries(rows)) {
    const got = bundle(run);
    assert.deepEqual(got.files, expected, `${name}: the bundle`);
    assert.deepEqual(got.electron.filter(n => n !== 'end.png'), expected.filter(n => n !== 'end.png'), `${name}: the Electron leg`);
    assert.ok(got.files.includes('end.png') && got.electron.includes('end.png'), `${name}: end.png always`);
  }
});

test('day folders older than 14 days go (15 removed, 13 kept), and nothing outside the evidence folder is touched', () => {
  const root = tmp(), dir = path.join(root, 'evidence'), now = new Date('2026-10-30T12:00:00Z');
  const day = ago => new Date(now.getTime() - ago * 86400000).toISOString().slice(0, 10);
  for (const ago of [15, 13, 0]) { fs.mkdirSync(path.join(dir, day(ago)), {recursive: true}); fs.writeFileSync(path.join(dir, day(ago), 'x'), '1'); }
  fs.mkdirSync(path.join(dir, 'notes-old')); fs.mkdirSync(path.join(root, '2020-01-01'));   // not a day folder; a day folder outside
  const lines = [];
  const removed = removeOldEvidence(dir, now, line => lines.push(line));
  assert.deepEqual(removed, [day(15)]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['notes-old', day(0), day(13)].sort());
  assert.ok(fs.existsSync(path.join(root, '2020-01-01')));
  assert.deepEqual(lines, [`evidence: removed 1 folders older than ${KEEP_DAYS} days`]);
  assert.throws(() => removeOldEvidence(root, now, () => {}), /not an evidence folder/);
});

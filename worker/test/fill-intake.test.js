// The intake workflow puts a report's snapshot in its issue where tools/fill-fixture.mjs finds it: runs the workflow's
// own script with a stand-in `gh`, then turns the issue it wrote into a fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitize } from '../src/report.js';
import { fromIssue, MARK } from '../../tools/fill-fixture.mjs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/fill-failure-intake.yml', import.meta.url), 'utf8');
const script = workflow.match(/python3 - <<'PY'\n([\s\S]*?)\n\s*PY\n/)[1].split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');

// Runs the intake with a fake gh: `issues` is what `gh issue list` returns, `thread` what `gh issue view` returns.
function intake(report, { issues = [], thread = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-'));
  const log = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('fs'); const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'issue' && args[1] === 'list') process.stdout.write(${JSON.stringify(JSON.stringify(issues))});
if (args[0] === 'issue' && args[1] === 'view') process.stdout.write(${JSON.stringify(JSON.stringify(thread))});
`, { mode: 0o755 });
  execFileSync('python3', ['-c', script], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, REPO: 'o/r',
    REPORT: JSON.stringify(report), TRUSTED: 'true' } });
  return fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

const report = sanitize({ site: 'job-boards.greenhouse.io', version: '0.8.16', fields: [{ label: 'Degree', type: 'combobox',
  reason: 'dropdown clicked, but no option matched', snapshot: { t: 'div', a: { class: 'select__container' }, c: [
    { t: 'label', a: { for: 'degree' }, c: ['Degree'] }, { t: 'input', a: { id: 'degree', role: 'combobox', 'data-jp-field': '' }, c: [] },
    { t: 'div', a: { role: 'listbox' }, c: [{ t: 'div', a: { role: 'option' }, c: ["Master's Degree"] }] }] } }] });

test('a new issue carries the snapshot in a marked block, and fill-fixture.mjs turns it into a fixture', () => {
  const calls = intake(report);
  const create = calls.find((args) => args[0] === 'issue' && args[1] === 'create');
  const body = create[create.indexOf('--body') + 1];
  assert.ok(body.includes(MARK));
  assert.ok(!/"snapshot"/.test(body));  // not repeated in the JSON block
  const fixture = fromIssue({ number: 16, body }, { answer: "Master's", expect: { picked: "Master's Degree" } });
  assert.equal(fixture.name, 'job-boards.greenhouse.io--degree');
  assert.equal(fixture.html, report.fields[0].snapshot);
  assert.deepEqual([fixture.spec.source, fixture.spec.label, fixture.spec.reason], ['issue #16', 'Degree', 'dropdown clicked, but no option matched']);
});

test('an issue from before snapshots gets the snapshot as a comment, once', () => {
  const title = 'Fill failure: job-boards.greenhouse.io · Degree';
  const old = '- Site: `job-boards.greenhouse.io`\n- Reason: dropdown clicked, but no option matched\n\n```json\n{"label": "Degree"}\n```\n';
  const calls = intake(report, { issues: [{ number: 16, title }], thread: { body: old, comments: [] } });
  const comment = calls.find((args) => args[1] === 'comment');
  const text = comment[comment.indexOf('--body') + 1];
  assert.ok(text.includes(MARK));
  assert.equal(fromIssue({ number: 16, body: old, comments: [{ body: text }] }).html, report.fields[0].snapshot);
  const again = intake(report, { issues: [{ number: 16, title }], thread: { body: old, comments: [{ body: text }] } });
  const second = again.find((args) => args[1] === 'comment');
  assert.ok(!second[second.indexOf('--body') + 1].includes(MARK));  // already there: just "Seen again"
});

// A replay workflow starts on a PR only for what it loads (owner, 14 Oct 2026: #771 changed the recorder and ran every page case through `desktop/e2e/**`):
// its `on: pull_request: paths:` lists exactly tools/replay-files.mjs's files for it (the job's pages, the extension, the app, every script its steps start), plus install files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WORKFLOW_JOB, workflowFiles, pathEntries, appFiles} from '../../tools/replay-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INSTALL = /^(desktop\/(e2e\/)?package(-lock)?\.json|\.github\/workflows\/[\w-]+\.yml)$/;

const prPaths = workflow => {
  const text = fs.readFileSync(path.join(ROOT, '.github/workflows', workflow), 'utf8');
  const block = text.slice(text.indexOf('  pull_request:'), text.indexOf('\n  push:') > text.indexOf('  pull_request:') ? text.indexOf('\n  push:') : text.indexOf('\n  workflow_dispatch:'));
  return [...block.matchAll(/^\s+- '([^']+)'/gm)].map(found => found[1]);
};

for (const workflow of Object.keys(WORKFLOW_JOB)) test(`${workflow}: a PR starts it for exactly the files it loads`, () => {
  const listed = prPaths(workflow), wanted = pathEntries(workflowFiles(workflow));
  assert.deepEqual(wanted.filter(entry => !listed.includes(entry)), [], `${workflow} misses files it loads: run node tools/replay-files.mjs --paths ${workflow}`);
  assert.deepEqual(listed.filter(entry => !wanted.includes(entry) && !INSTALL.test(entry)), [], `${workflow} lists files it does not load`);
  assert.ok(!listed.some(entry => /^desktop\/e2e\/(\*\*|lib\/\*\*|test\/\*\*)$/.test(entry)), `${workflow}: no glob over the whole harness`);
});

test('a script a step starts is part of its workflow\'s files (the replays report imports the upload code)', () => {
  assert.ok(workflowFiles('page-cases.yml').has('desktop/e2e/lib/applying-report.mjs'));
  assert.ok(!workflowFiles('page-cases.yml').has('desktop/e2e/smoke.mjs'), 'the recorder is not a page case');
});

test('site-replays-pr.yml: a PR starts it for the apply flow\'s code only: the extension, the app and the worker files it copies in (#778 changed the answer prompt and started none)', () => {
  assert.deepEqual(prPaths('site-replays-pr.yml'), pathEntries(appFiles()));
  assert.ok(prPaths('site-replays-pr.yml').includes('worker/src/answer-facts.js'));
});

// The automatic flow-files claim (tools/flow-fresh.mjs): a PR fails when main changed, since its base, a flow file the PR also changes; any file of FLOW_FILES or FLOW_CORE counts, nothing else does.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {clashes, flowTouched, message} from '../../tools/flow-fresh.mjs';
import {FLOW_CORE, FLOW_FILES} from '../e2e/flows.mjs';

test('every flow file and every flow-core file counts, other files never', () => {
  for (const file of [...FLOW_FILES, ...FLOW_CORE]) assert.deepEqual(flowTouched([file]), [file], file);
  assert.deepEqual(flowTouched(['README.md', 'desktop/renderer/pages/jobs.js', 'docs/flows/applying.md']), []);
});

test('a clash is a flow file both sides changed', () => {
  assert.deepEqual(clashes(['extension/fill-flow.js', 'README.md'], ['extension/fill-flow.js', 'README.md']), ['extension/fill-flow.js']);
  assert.deepEqual(clashes(['extension/fill-flow.js'], ['extension/tabs.js']), [], 'different flow files: no clash');
  assert.deepEqual(clashes(['README.md'], ['README.md']), [], 'a shared non-flow file is git\'s business');
  assert.match(message(['extension/tabs.js'], 'origin/main'), /Rebase on the new main/);
});

test('the command on a real repo: exit 1 when main moved a flow file the branch changed, 0 otherwise', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-fresh-'));
  const git = (...args) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'});
  const tool = path.resolve(import.meta.dirname, '../../tools/flow-fresh.mjs');
  const run = head => { try { execFileSync('node', [tool, '--root', dir, '--base', 'main', '--head', head], {encoding: 'utf8', stdio: 'pipe'}); return 0; } catch (error) { return error.status; } };
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T');
  fs.mkdirSync(path.join(dir, 'extension'));
  fs.writeFileSync(path.join(dir, 'extension/fill-flow.js'), '1\n'); git('add', '-A'); git('commit', '-qm', 'start');
  git('checkout', '-q', '-b', 'pr'); fs.writeFileSync(path.join(dir, 'extension/fill-flow.js'), '2\n'); git('commit', '-qam', 'mine');
  git('checkout', '-q', 'main'); fs.writeFileSync(path.join(dir, 'extension/fill-flow.js'), '3\n'); git('commit', '-qam', 'theirs');
  git('checkout', '-q', 'pr');
  assert.equal(run('pr'), 1, 'main moved the flow file the branch changed');
  const mb = git('merge-base', 'main', 'pr').trim();
  git('checkout', '-q', '-B', 'pr2', mb); fs.mkdirSync(path.join(dir, 'docs')); fs.writeFileSync(path.join(dir, 'docs/x.md'), 'x\n'); git('add', '-A'); git('commit', '-qm', 'docs');
  assert.equal(run('pr2'), 0, 'a branch that changes no flow file is never held');
});

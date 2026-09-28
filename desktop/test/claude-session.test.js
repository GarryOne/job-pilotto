import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as session from '../lib/claude-session.js';
import {createStorage} from '../lib/storage.js';

const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-session-')), {encrypt: v => v, decrypt: v => v});

test('the session gets Notion and the app folders, the app\'s python3 first, never the API key', () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-app');
  const env = session.sessionEnv(storage, {PATH: '/usr/bin', HOME: '/Users/x', ANTHROPIC_API_KEY: 'sk-ant-shell'}, 'darwin', '/data/bin');
  assert.equal(env.NOTION_TOKEN, 'ntn_x');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.PATH, '/data/bin:/usr/bin');
  assert.equal(env.HOME, '/Users/x');
  assert.equal(env.JOB_PILOTTO_APPLY_RUN_DIR, storage.path('apply-runs'));
  const win = session.sessionEnv(storage, {Path: 'C:\\Windows'}, 'win32', 'C:\\data\\bin');
  assert.equal(win.Path, 'C:\\data\\bin;C:\\Windows');
});

test('python3 for the session is a small script pointing at the app\'s Python (forward slashes on Windows)', () => {
  const storage = tempStorage();
  assert.equal(session.pythonShim(storage, 'python3', 'darwin'), null);
  const dir = session.pythonShim(storage, 'C:\\Users\\x\\AppData\\Local\\Programs\\Job Pilotto\\resources\\pilot\\python\\python.exe', 'win32');
  assert.match(fs.readFileSync(path.join(dir, 'python3'), 'utf8'), /exec 'C:\/Users\/x\/AppData\/Local\/Programs\/Job Pilotto\/resources\/pilot\/python\/python.exe' "\$@"/);
});

test('the prompt names the job, the audit file and the hand-off ticket, and uses the password helper', () => {
  const text = session.prompt('https://jobs.example.com/1', {ticket: 'abc', auditFile: 'C:/Temp/audit_1.json'});
  assert.match(text, /apply-to-job skill/);
  assert.match(text, /--audit "C:\/Temp\/audit_1.json"/);
  assert.match(text, /ticket:'abc'/);
  assert.match(text, /src\.ai\.passwords/);
  assert.doesNotMatch(text, /security find-generic-password|\/tmp\//);
  assert.doesNotMatch(session.prompt('https://x/1', {auditFile: 'a.json'}), /jobpilotto:fill/);
});

test('Windows: one console window per job through start, reading its instructions from a file', async () => {
  assert.equal(session.windowsCommand({claude: 'C:\\Users\\x\\.local\\bin\\claude.exe', repo: 'C:\\App\\pilot', promptFile: 'C:\\Temp\\p_1.txt'}),
    '"start "Job Pilotto" /D "C:\\App\\pilot" "C:\\Users\\x\\.local\\bin\\claude.exe" --chrome --permission-mode bypassPermissions ' +
    '"Read the file C:/Temp/p_1.txt and do exactly what it says.""');
  const storage = tempStorage();
  const spawned = [], steps = [];
  const run = (command, args, options) => { spawned.push({command, args, options}); return {unref() {}}; };
  const count = await session.launch(storage, ['https://a/1', 'https://b/2'], {claude: 'claude.exe', platform: 'win32', run, gap: 0,
    pipelineRun: async (_, args) => { steps.push(args); return {code: 0}; }, ticket: () => 't'});
  assert.equal(count, 2);
  assert.deepEqual(steps, [['src.ai.apply_batch', '--mark-applying', 'https://a/1'], ['src.ai.apply_batch', '--mark-applying', 'https://b/2']]);
  assert.equal(spawned.length, 2);  // no Mac watcher
  assert.deepEqual(spawned[0].args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(spawned[0].options.windowsVerbatimArguments, true);
  const file = spawned[0].args[3].match(/Read the file (\S+) and/)[1];
  assert.match(fs.readFileSync(file, 'utf8'), /apply to this job: https:\/\/a\/1/);
});

test('Mac: a Terminal window per job whose shell loads the session variables from a private file, plus the submit watcher', async () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  const spawned = [];
  const run = (command, args, options) => { spawned.push({command, args, options}); return {unref() {}}; };
  await session.launch(storage, ['https://a/1'], {claude: '/usr/local/bin/claude', platform: 'darwin', run, gap: 0,
    pipelineRun: async () => ({code: 0}), ticket: () => ''});
  assert.equal(spawned[0].command, 'osascript');
  assert.match(spawned[0].args[1], /--permission-mode bypassPermissions/);
  const envFile = spawned[0].args[1].match(/\. '([^']+session_1\.env)'/)[1];
  if (process.platform !== 'win32') assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);  // Windows has no Unix modes
  assert.match(fs.readFileSync(envFile, 'utf8'), /export NOTION_TOKEN='ntn_x'/);
  assert.doesNotMatch(fs.readFileSync(envFile, 'utf8'), /ANTHROPIC_API_KEY/);
  assert.match(spawned[1].command, /tools\/wait-and-mark-applied\.sh$/);
});

// The automatic refill starts when what the AI is asked changes, not when one file name changes (lib/prompt-sources.mjs, refill-trigger.mjs; owner, 15 Oct 2026: #904's worker field list and #912's cv_facts rule changed asks, no refill ran).
// A real git repo in a temp folder: a change to the worker's field list or cv_facts rule triggers it, a score-only baseline change and an unrelated file do not; the workflow's push paths list exactly these files.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {LADDER_BASELINE, PROMPT_SOURCES, sourcesChanged, WORKER_AND_PAGE_SOURCES} from '../lib/prompt-sources.mjs';
import {PROMPT_FILES} from '../lib/ladder-fingerprint.mjs';

const here = path.dirname(new URL(import.meta.url).pathname), repoRoot = path.resolve(here, '..', '..', '..');
const trigger = path.join(here, '..', 'refill-trigger.mjs');

test('every ladder prompt file and the worker\'s ask-building files are sources, and each exists', () => {
  for (const item of PROMPT_FILES) assert.ok(PROMPT_SOURCES.includes(item.file), `${item.file} builds a ladder prompt: a change to it must be able to refill`);
  for (const file of WORKER_AND_PAGE_SOURCES) assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} is listed as a prompt source but does not exist: update lib/prompt-sources.mjs`);
  assert.ok(PROMPT_SOURCES.includes('worker/src/cv-facts.js') && PROMPT_SOURCES.includes('worker/src/extension.js'), 'the worker\'s field list and cv_facts rule');
});

test('the refill workflow starts on a push to exactly these files and the baseline', () => {
  const text = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'replay-refill.yml'), 'utf8');
  const listed = JSON.parse(text.match(/^    paths: (\[.*?\])\s+#/m)[1].replace(/'/g, '"'));
  assert.deepEqual([...listed].sort(), [LADDER_BASELINE, ...PROMPT_SOURCES].sort(), 'the push paths and lib/prompt-sources.mjs must list the same files');
});

test('sourcesChanged names the files whose content differs', () => {
  const file = 'worker/src/cv-facts.js';
  assert.deepEqual(sourcesChanged({[file]: 'a'}, {[file]: 'b'}), [file]);
  assert.deepEqual(sourcesChanged({[file]: 'a'}, {[file]: 'a'}), []);
  assert.deepEqual(sourcesChanged({}, {[file]: 'a'}), [file], 'a file new in the merge');
});

// A temp repo with every source file and a baseline; each commit changes one thing. -> what refill-trigger.mjs prints for the last commit.
function triggerFor(change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-trigger-')), git = (...args) => execFileSync('git', args, {cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8'});
  try {
    git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
    const write = (file, body) => { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), body); };
    for (const file of PROMPT_SOURCES) write(file, `// ${file}\n`);
    const baseline = score => JSON.stringify({promptFingerprint: {rung2: 'a', rung3: 'b'}, fixtures: {x: score}});
    write(LADDER_BASELINE, baseline(1)); write('README.md', 'x'); git('add', '-A'); git('commit', '-qm', 'before');
    const before = git('rev-parse', 'HEAD').trim(); fs.copyFileSync(path.join(dir, LADDER_BASELINE), path.join(dir, 'before.json'));
    change(write, baseline); git('add', '-A'); git('commit', '-qm', 'merge');
    const out = spawnSync(process.execPath, [trigger, path.join(dir, 'before.json'), path.join(dir, LADDER_BASELINE), before], {cwd: dir, encoding: 'utf8'});
    return out.stdout.trim().split('\n');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('a change only to the worker\'s field list triggers the refill', () => {
  const said = triggerFor(write => write('worker/src/extension.js', '// a field with multiple: true\n'));
  assert.equal(said.at(-1), 'changed');
  assert.match(said.join('\n'), /worker\/src\/extension\.js/);
});

test('a change only to the cv_facts rule triggers the refill', () => assert.equal(triggerFor(write => write('worker/src/cv-facts.js', '// years from roles\n')).at(-1), 'changed'));
test('a change to the page-side field read triggers the refill', () => assert.equal(triggerFor(write => write('extension/page/fill-read.js', '// multiple\n')).at(-1), 'changed'));
test('a ladder prompt fingerprint change still triggers it', () => assert.equal(triggerFor((write, baseline) => write(LADDER_BASELINE, baseline(1).replace('"a"', '"a2"'))).at(-1), 'changed'));
test('a score-only baseline change does not trigger it', () => assert.deepEqual(triggerFor((write, baseline) => write(LADDER_BASELINE, baseline(2))), ['same']));
test('a change to an unrelated file does not trigger it', () => assert.deepEqual(triggerFor(write => write('worker/src/scheduler.js', '// cron\n')), ['same']));

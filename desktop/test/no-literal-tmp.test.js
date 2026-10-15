// Tests make their temp folders with os.tmpdir() (Windows CI has no /tmp: main went red on 11 Oct 2026). Loops over every tracked JS file and fails on a file-system call given a literal /tmp path.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const FS_CALL = /\b(?:writeFile|writeFileSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|appendFile|appendFileSync|rmSync|rm|copyFile|copyFileSync|readFileSync|existsSync)\(\s*['"`]\/tmp\b/;

test('no file-system call takes a literal /tmp path: temp folders come from os.tmpdir()', () => {
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: repo, maxBuffer: 1 << 26}).toString().split('\0').filter(file => /\.(js|mjs|cjs)$/.test(file) && !/node_modules/.test(file));
  const found = files.flatMap(file => readFileSync(join(repo, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line]).filter(([, , line]) => FS_CALL.test(line)).map(([f, n]) => `${f}:${n}`));
  assert.deepEqual(found, []);
});

// No source file over 500 lines; the ones already over it may only shrink (tools/file-size.mjs, tools/file-size-allowed.json).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {LIMIT, WARN, sizeProblems, sizeWarnings} from '../../tools/file-size.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('every source file is within 500 lines, or within its listed size, which may only shrink', () => {
  const files = execFileSync('git', ['-C', root, 'ls-files'], {encoding: 'utf8'}).split('\n').filter(Boolean);
  const allowed = JSON.parse(fs.readFileSync(path.join(root, 'tools/file-size-allowed.json'), 'utf8'));
  const linesOf = file => { try { return fs.readFileSync(path.join(root, file), 'utf8').split('\n').length - 1; } catch { return 0; } };
  assert.deepEqual(sizeProblems(files, linesOf, allowed), []);
});

test('the rule: a new file over 500 fails, a listed one may not grow, one that shrank lowers its entry', () => {
  const sizes = {'a.js': 501, 'b.py': 900, 'c.js': 499, 'd.mjs': 450, 'e.js': 800};
  const problems = sizeProblems(Object.keys(sizes), file => sizes[file], {'b.py': 880, 'd.mjs': 600, 'e.js': 820});
  assert.equal(LIMIT, 500);
  assert.ok(problems.some(line => line.startsWith('a.js: 501 lines, over 500')));
  assert.ok(problems.some(line => line.startsWith('b.py: 900 lines, over its 880')));
  assert.ok(problems.some(line => line.startsWith('d.mjs is 450 lines now')));
  assert.ok(problems.some(line => line.startsWith('e.js shrank to 800')));
  assert.ok(!problems.some(line => line.startsWith('c.js')));
});

test('a touched file between 450 and 500 lines gets a split warning, never a block; small, allowed and excepted files do not', () => {
  const lines = {'a.js': WARN, 'b.js': 300, 'c.mjs': LIMIT, 'big.js': 900, 'extension/review.js': 480, 'notes.md': 470};
  const warned = sizeWarnings(Object.keys(lines), file => lines[file], {'big.js': 900});
  assert.deepEqual(warned.map(line => line.split(' ')[4]), ['a.js', 'c.mjs']);
  assert.match(warned[0], /^WARNING \(not a block\).*2 to 4 files by concern/);
  assert.deepEqual(sizeProblems(['a.js', 'c.mjs'], file => lines[file], {}), []);
});

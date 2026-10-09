// A file URL's .pathname is not a path on Windows ('/D:/a/…' becomes 'D:\D:\a\…'): tests use fileURLToPath. Red main three times on 9 Oct 2026
// (mac-words, cost-labels, claude-help), each only on the Windows runner. This catches the shape on any machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const dirs = ['test'].map(dir => path.join(desktop, dir));   // what the Windows runner runs; desktop/e2e/test runs on Linux and the Mac only

export function filePathnames(source) {
  const fileUrls = [...source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*new URL\([^;]*import\.meta\.url\)/g)].map(match => match[1]);
  const direct = [...source.matchAll(/import\.meta\.url\)\.pathname\b/g)].map(() => 'import.meta.url');
  const named = fileUrls.filter(name => new RegExp(`\\b${name}\\.pathname\\b`).test(source));
  return [...direct, ...named];
}

test('the check finds a file URL used as a path, and leaves fileURLToPath alone', () => {
  assert.deepEqual(filePathnames("const RENDERER = new URL('../renderer/', import.meta.url);\nfiles(RENDERER.pathname);"), ['RENDERER']);
  assert.deepEqual(filePathnames("const here = new URL('.', import.meta.url).pathname;"), ['import.meta.url']);
  assert.deepEqual(filePathnames("const R = new URL('../r/', import.meta.url);\nfiles(fileURLToPath(R)); const u = new URL(String(x)).pathname;"), []);
});

test('no desktop test turns a file URL into a path with .pathname', () => {
  const found = dirs.flatMap(dir => fs.readdirSync(dir).filter(name => /\.(m?js)$/.test(name)).map(name => path.join(dir, name)))
    .filter(file => file !== fileURLToPath(import.meta.url))
    .flatMap(file => filePathnames(fs.readFileSync(file, 'utf8')).map(name => `${path.relative(desktop, file)}: ${name}.pathname`));
  assert.deepEqual(found, []);
});

// The build before a fix (lib/older-tree.mjs): main's tools and app with the old extension laid over as a union; the files the app shares with the extension stay main's. Real git in a temp repo.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {SHARED, overlayExtension, sharedTouched} from '../lib/older-tree.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'older-tree-')), git = (...args) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'}).trim();
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), text); };
  git('init', '-q'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'n');
  return {dir, git, put, commit: message => { git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD'); }};
}

test('the old extension lays over main as a union: its files replace, main-only files stay, shared files stay main\'s', () => {
  const r = repo();
  r.put('extension/fill.js', 'old fill\n'); r.put('extension/recipe-schema.js', 'export const a = 1;\n');
  const before = r.commit('before the fix');
  r.put('extension/fill.js', 'fixed fill\n'); const fix = r.commit('the fix');
  r.put('extension/page/option-groups.js', 'added later\n'); r.put('extension/recipe-schema.js', 'export const a = 1; export const whyWord = 1;\n'); r.put('extension/fill.js', 'main fill\n'); r.commit('later');
  overlayExtension(r.dir, `${fix}^`);
  assert.equal(fs.readFileSync(path.join(r.dir, 'extension/fill.js'), 'utf8'), 'old fill\n', 'the old file replaces main\'s');
  assert.equal(fs.existsSync(path.join(r.dir, 'extension/page/option-groups.js')), true, 'a file only main has stays (the harness reads it)');
  assert.match(fs.readFileSync(path.join(r.dir, 'extension/recipe-schema.js'), 'utf8'), /whyWord/, 'a shared file stays main\'s (the app imports whyWord)');
  assert.ok(before);
});

test('a fix that changes a shared file cannot be told from main offline; any other fix can', () => {
  const r = repo();
  r.put('extension/fill.js', 'a\n'); r.put('extension/recipe-schema.js', 'a\n'); r.commit('base');
  r.put('extension/fill.js', 'b\n'); const flow = r.commit('flow fix');
  r.put('extension/recipe-schema.js', 'b\n'); r.put('extension/manifest.json', '{}'); const shared = r.commit('shared fix');
  r.put('extension/manifest.json', '{"v":2}'); const stamp = r.commit('version only');
  const git = (...args) => r.git(...args);
  assert.deepEqual(sharedTouched(flow, git), []);
  assert.deepEqual(sharedTouched(shared, git), ['extension/recipe-schema.js']);
  assert.deepEqual(sharedTouched(stamp, git), [], 'the version stamp is not a fix');
});

test('every extension file stage.mjs copies into the app is in SHARED', () => {
  const stage = fs.readFileSync(path.join(REPO, 'desktop/scripts/stage.mjs'), 'utf8'), found = new Set();
  for (const [, tail] of stage.matchAll(/path\.join\(repo, 'extension', ((?:'[^']+'(?:, )?)+)\)/g)) found.add(`extension/${[...tail.matchAll(/'([^']+)'/g)].map(m => m[1]).join('/')}`);
  for (const [, list] of stage.matchAll(/for \(const file of \[([^\]]+)\]\) fs\.copyFileSync\(path\.join\(repo, 'extension', '(\w+)', file\)/g)) { /* below */ }
  for (const [, list] of stage.matchAll(/for \(const file of \[([^\]]+)\]\) fs\.copyFileSync\(path\.join\(repo, 'extension', '([\w-]+)'/g)) for (const [, file] of list.matchAll(/'([^']+)'/g)) found.add(`extension/${stage.match(/path\.join\(repo, 'extension', '([\w-]+)', file\)/)[1]}/${file}`);
  assert.ok(found.size >= 5, [...found].join(', '));
  for (const file of found) assert.ok(SHARED.includes(file), `${file} is copied into the app by stage.mjs but not in SHARED`);
});

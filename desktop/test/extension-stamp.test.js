// The extension's version is stamped at build (scripts/extension-stamp.mjs): a later extension commit gives a higher version, the same tree the same one,
// a shallow clone or a missing count fails the build, and every stamp is above the last version committed by hand.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LAST_COMMITTED, count, forBuild, newer, stamp, stampedAt, version} from '../scripts/extension-stamp.mjs';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-stamp-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], {stdio: 'ignore'});
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  const commit = (file, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
    fs.writeFileSync(path.join(dir, file), body);
    git('add', '-A'); git('commit', '-q', '-m', file);
  };
  commit('extension/manifest.json', '{"version": "0.9"}\n');
  commit('extension/fill.js', '// 1\n');
  return {dir, commit};
}

test('a later extension commit stamps a higher version; a commit elsewhere keeps it', () => {
  const {dir, commit} = repo();
  const first = forBuild({repo: dir, env: {}, floor: '0'});
  commit('docs/a.md', 'a\n');
  assert.equal(forBuild({repo: dir, env: {}, floor: '0'}), first, 'same extension tree, same version');
  commit('extension/fill.js', 'changed\n');
  const second = forBuild({repo: dir, env: {}, floor: '0'});
  assert.ok(newer(second, first), `${second} > ${first}`);
  assert.equal(second, '0.9.3');
});

test('every stamp is above the last version committed by hand', () => {
  assert.throws(() => version({manifestVersion: '0.9', commits: 100}), /not above 0\.9\.270/);
  assert.ok(newer(version({manifestVersion: '0.9.270', commits: 271}), LAST_COMMITTED));
  assert.throws(() => forBuild({repo: repo().dir, env: {EXTENSION_VERSION: '0.9.12'}}), /not a version above/);
});

test('no count, no build: a missing or empty count fails, never a silent 0.9.0', () => {
  assert.throws(() => version({manifestVersion: '0.9', commits: 0}), /no extension commit count/);
  assert.throws(() => version({manifestVersion: '0.9', commits: NaN}), /no extension commit count/);
  assert.throws(() => forBuild({repo: repo().dir, env: {EXTENSION_VERSION: 'x'}}), /not a version/);
});

test('a shallow clone refuses to count', () => {
  const {dir} = repo();
  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-stamp-shallow-'));
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir.split(path.sep).join('/')}`, shallow], {stdio: 'ignore'});
  assert.throws(() => count(shallow), /shallow clone/);
  assert.throws(() => forBuild({repo: shallow, env: {}, floor: '0'}), /shallow clone/);
  assert.equal(forBuild({repo: shallow, env: {EXTENSION_VERSION: '0.9.400'}}), '0.9.400', 'CI hands the full clone\'s count over');
});

test('the stamp goes into a copy, never the repo\'s own extension folder', () => {
  const {dir} = repo();
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-stamp-copy-'));
  fs.cpSync(path.join(dir, 'extension'), copy, {recursive: true});
  stamp(copy, '0.9.301');
  assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8')).version, '0.9.301');
  assert.throws(() => stamp(fileURLToPath(new URL('../../extension', import.meta.url)), '0.9.301'), /a copy/);
});

test('this repo\'s own stamp is above the last committed version (installed copies keep rising at the switch)', t => {
  let stamped;
  try { stamped = forBuild({env: {}}); } catch (error) { if (/shallow clone/.test(error.message)) return t.skip('shallow checkout: CI counts on a full clone'); throw error; }
  assert.ok(newer(stamped, LAST_COMMITTED), `${stamped} > ${LAST_COMMITTED}`);
});

test('a copy reports the stamp at a commit; a shallow CI clone fetches the history first, elsewhere the manifest\'s version', () => {
  const {dir, commit} = repo();
  commit('extension/fill.js', 'later\n');
  assert.equal(stampedAt(dir), '0.9.3');
  assert.equal(stampedAt(dir, 'HEAD~1'), '0.9.2');
  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-stamp-shallow-'));
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir.split(path.sep).join('/')}`, shallow], {stdio: 'ignore'});
  assert.equal(stampedAt(shallow, 'HEAD', {}), '0.9', 'off CI: the manifest\'s version, nothing fetched');
  assert.equal(stampedAt(shallow, 'HEAD', {CI: 'true'}), '0.9.3', 'on CI: the history is fetched, then counted');
  assert.equal(stampedAt(path.join(os.tmpdir(), 'no-such-repo-ext-stamp')), '');
});

test('the repo\'s manifest holds only the base: no PR writes the extension\'s version (each one made every other extension PR conflict)', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+$/, 'extension/manifest.json "version" is the base ("0.9"); the build stamps the rest (scripts/extension-stamp.mjs)');
  assert.ok(!fs.existsSync(new URL('../../extension/fingerprint.json', import.meta.url)), 'extension/fingerprint.json is gone: the stamp replaced it');
});

// Every private file the app writes ends up 0600, also when it already existed (Node's {mode} applies only to a new file: 13 Oct 2026, the test app's job-site
// passwords were written 0644). The class: any writeFileSync with a 0600 mode must go through lib/private-file.js writePrivate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {writePrivate} from '../lib/private-file.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? (entry.name === 'node_modules' || entry.name === 'test' ? [] : sources(path.join(dir, entry.name))) : /\.m?js$/.test(entry.name) ? [path.join(dir, entry.name)] : []));

test('an existing world-readable file becomes 0600', {skip: process.platform === 'win32'}, () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-private-')), 'secrets.json');
  fs.writeFileSync(file, '{}', {mode: 0o644});
  writePrivate(file, '{"a":1}');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
});

test('no file under desktop/lib or desktop/e2e/lib writes a 0600 file without writePrivate', () => {
  const offenders = [path.join(here, '..', 'lib'), path.join(here, '..', 'e2e', 'lib')].flatMap(sources).filter(file => !file.endsWith('private-file.js'))
    .flatMap(file => fs.readFileSync(file, 'utf8').split('\n').map((line, at) => [file, at + 1, line])).filter(([, , line]) => /writeFileSync\(.*0o600/.test(line))
    .map(([file, at]) => `${path.relative(path.join(here, '..'), file).replace(/\\/g, '/')}:${at}`);
  assert.deepEqual(offenders, [], 'use writePrivate (lib/private-file.js): {mode} alone leaves an existing file readable by others');
});

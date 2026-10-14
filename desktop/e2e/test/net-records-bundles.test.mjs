// A publish ADDS a bundle to the release net-records, never replaces the set (14 Oct 2026: publishing 7 rows would have dropped 11 of 18), and net-records-fetch.sh,
// the one reader, unpacks every bundle so the newest record per row wins. Offline: a throwaway key pair and a fake `gh` that serves a folder as the release.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundleNames} from '../records-publish.mjs';
import {newestPerRow} from '../replay-records.mjs';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(E2E, '../..');

test('each publish has its own asset names, so an upload never overwrites another bundle', () => {
  const one = bundleNames(new Date('2026-10-14T21:03:07Z')), two = bundleNames(new Date('2026-10-14T22:15:00Z'));
  assert.deepEqual(one, {bundle: 'net-records-20261014T210307Z.tgz.enc', key: 'net-records-20261014T210307Z.k.enc'});
  assert.notEqual(one.bundle, two.bundle);
  assert.doesNotMatch(fs.readFileSync(path.join(E2E, 'records-publish.mjs'), 'utf8'), /'--clobber'/, 'records-publish uploads without --clobber');
});

test('every reader of the release goes through net-records-fetch.sh: no second copy of the decrypt lines', () => {
  const files = execFileSync('git', ['grep', '-l', '-e', 'pkeyutl -decrypt', '--', '.github', 'desktop/e2e', 'tools', ':!*/test/*'], {cwd: ROOT, encoding: 'utf8'}).trim().split('\n');
  assert.deepEqual(files, ['desktop/e2e/net-records-fetch.sh']);
});

test('the fetch unpacks every bundle (the first set and each added one) and the newest record per row wins', {skip: process.platform === 'win32' && 'bash and openssl'}, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bundles-')), release = path.join(tmp, 'release'), bin = path.join(tmp, 'bin'), out = path.join(tmp, 'out');
  fs.mkdirSync(release); fs.mkdirSync(bin);
  const sh = (cmd, cwd = tmp) => execFileSync('bash', ['-c', cmd], {cwd, stdio: ['ignore', 'pipe', 'pipe']});
  sh('openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out priv.pem 2>/dev/null && openssl pkey -in priv.pem -pubout -out pub.pem');
  // A bundle as records-publish.mjs makes it: net-records/<row>/record.json, tar + AES with a random key, the key RSA-OAEP with the public key.
  const bundle = (bundleFile, keyFile, rows) => {
    const work = fs.mkdtempSync(path.join(tmp, 'b-'));
    for (const [dir, record] of rows) { fs.mkdirSync(path.join(work, 'net-records', dir), {recursive: true}); fs.writeFileSync(path.join(work, 'net-records', dir, 'record.json'), JSON.stringify(record)); }
    sh(`tar czf net.tgz net-records && openssl rand -out k 32 && openssl enc -aes-256-cbc -pbkdf2 -salt -in net.tgz -out "${path.join(release, bundleFile)}" -pass file:k`
      + ` && openssl pkeyutl -encrypt -pubin -inkey "${path.join(tmp, 'pub.pem')}" -pkeyopt rsa_padding_mode:oaep -in k -out "${path.join(release, keyFile)}"`, work);
  };
  bundle('net-records.tgz.enc', 'net-records.k.enc', [['a', {name: 'row a', url: 'https://a.example.test/', startMs: 1}], ['b', {name: 'row b', url: 'https://b.example.test/', startMs: 1}]]);
  const added = bundleNames(new Date('2026-10-14T22:15:00Z'));
  bundle(added.bundle, added.key, [['a2', {name: 'row a', url: 'https://a.example.test/', startMs: 2}], ['c', {name: 'row c', url: 'https://c.example.test/', startMs: 2}]]);
  // gh: `release download` copies the folder's matching assets, `run list` has no recording runs.
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
case "$1 $2" in
  "release download") dir=""; while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done; mkdir -p "$dir"; cp "${release}"/net-records* "$dir"/ ;;
  *) exit 0 ;;
esac
`, {mode: 0o755});
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, NET_RECORD_KEY: fs.readFileSync(path.join(tmp, 'priv.pem')).toString('base64'), RUNNER_TEMP: tmp, NET_RECORDS_READ_TOKEN: 'read-only'};
  execFileSync('bash', [path.join(E2E, 'net-records-fetch.sh'), out], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const rows = Object.fromEntries(newestPerRow(out, new Map()).map(row => [row.name, row]));
  assert.deepEqual(Object.keys(rows).sort(), ['row a', 'row b', 'row c'], 'the first set\'s rows stay beside the added bundle\'s');
  assert.equal(rows['row a'].record.startMs, 2, 'a re-recorded row: the newer bundle\'s record wins');
  assert.match(rows['row b'].dir, /[\\/]mac[\\/]/, 'unpacked under mac/: whereOf says the Mac made it');
  fs.rmSync(tmp, {recursive: true, force: true});
});

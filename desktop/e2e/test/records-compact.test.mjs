// Guard for records-compact (lib/records-compact.mjs): a fake release holds old bundles; compaction backs them up, keeps the newest record per row and removes the old assets only after.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {compactRelease, listAssets, sha256} from '../lib/records-compact.mjs';
import {packBundle} from '../lib/records-pack.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-compact-test-'));
const ssl = (...a) => execFileSync('openssl', a, {stdio: 'ignore'});
function keys() {
  const dir = tmp(), priv = path.join(dir, 'priv.pem'), pub = path.join(dir, 'pub.pem');
  ssl('genrsa', '-out', priv, '2048'); ssl('rsa', '-in', priv, '-pubout', '-out', pub);
  return {priv, pub};
}
function rowDir(root, name, startMs, note) {
  const dir = path.join(root, `${name}-${startMs}`);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({name, url: `https://${name}.example/job`, startMs, note}));
  return {dir, as: path.basename(dir)};
}

// gh as a folder per release tag; digest like GitHub's newer API unless `noDigest`.
function fakeGh(store, {noDigest = false, corruptBackup = false, onUpload = () => {}} = {}) {
  const dirOf = tag => { if (!store.has(tag)) throw new Error('release not found'); return store.get(tag); };
  const flag = (a, name) => a[a.indexOf(name) + 1];
  const gh = a => {
    const [, verb, tag] = a[0] === 'release' ? a : [];
    if (a[0] !== 'release') throw new Error('unexpected ' + a.join(' '));
    if (a[1] === 'view') { const d = dirOf(a[2]); return JSON.stringify({assets: fs.readdirSync(d).map(name => ({name, size: fs.statSync(path.join(d, name)).size, ...(noDigest ? {} : {digest: 'sha256:' + sha256(path.join(d, name))})}))}); }
    if (a[1] === 'create') { store.set(a[2], tmp()); return ''; }
    if (a[1] === 'download') { const d = dirOf(a[2]); for (const n of fs.readdirSync(d)) fs.copyFileSync(path.join(d, n), path.join(flag(a, '--dir'), n)); return ''; }
    if (a[1] === 'upload') { const d = dirOf(a[2]); for (const f of a.slice(3).filter(x => !x.startsWith('-') && x !== a[a.indexOf('-R') + 1])) { onUpload(a[2], f); fs.copyFileSync(f, path.join(d, path.basename(f))); if (corruptBackup && a[2].includes('backup')) fs.appendFileSync(path.join(d, path.basename(f)), 'x'); } return ''; }
    if (a[1] === 'delete-asset') { fs.rmSync(path.join(dirOf(a[2]), a[3])); return ''; }
    throw new Error('unexpected ' + a.join(' '));
  };
  return gh;
}

function setup() {
  const {priv, pub} = keys(), work = tmp(), live = tmp(), store = new Map([['net-records', live]]);
  const rows = tmp();
  const put = (name, ...dirs) => { const w = tmp(); packBundle(w, name, dirs, pub); for (const f of fs.readdirSync(w)) fs.copyFileSync(path.join(w, f), path.join(live, f)); };
  put('net-records', rowDir(rows, 'alpha', 1000, 'old'), rowDir(rows, 'beta', 1000, 'only'));
  put('net-records-20261016T000000Z', rowDir(rows, 'alpha', 2000, 'new'));
  put('net-records-20261017T000000Z-g1', rowDir(rows, 'gamma', 3000, 'g'));
  return {priv, pub, work, live, store};
}
const noteOf = (dir, enc, name, priv) => { const into = tmp(); execFileSync('openssl', ['pkeyutl', '-decrypt', '-inkey', priv, '-pkeyopt', 'rsa_padding_mode:oaep', '-in', path.join(dir, name + '.k.enc'), '-out', path.join(into, 'k')], {stdio: 'ignore'}); return into; };

test('compaction backs up every asset, keeps the newest record per row, then removes the old assets', () => {
  const {priv, pub, work, live, store} = setup();
  assert.equal(listAssets(fakeGh(store), 'r/r', 'net-records').length, 6);
  const gh = fakeGh(store), log = [];
  const result = compactRelease(gh, {repo: 'r/r', tag: 'net-records', backupTag: 'net-records-backup-x', work, privKeyFile: priv, pubKey: pub, stamp: '20261017T120000Z', retry: f => f(), log: l => log.push(l)});
  assert.deepEqual([result.before, result.after, result.rows], [6, 2, 3]);
  assert.deepEqual(fs.readdirSync(live).sort(), ['net-records-20261017T120000Z-c1.k.enc', 'net-records-20261017T120000Z-c1.tgz.enc']);
  assert.equal(fs.readdirSync(store.get('net-records-backup-x')).length, 6);
  assert.ok(log.some(l => /count and sha256 verified/.test(l)));
  // the new bundle holds alpha's NEWER record, beta and gamma
  const out = path.join(tmp(), 'o');
  execFileSync('bash', ['-c', `set -e; d=$(mktemp -d); openssl pkeyutl -decrypt -inkey ${priv} -pkeyopt rsa_padding_mode:oaep -in ${live}/net-records-20261017T120000Z-c1.k.enc -out $d/k; openssl enc -d -aes-256-cbc -pbkdf2 -in ${live}/net-records-20261017T120000Z-c1.tgz.enc -pass file:$d/k | tar xz -C $d; mkdir -p ${out}; cat $d/*/record.json > ${out}/all.txt`]);
  const all = fs.readFileSync(path.join(out, 'all.txt'), 'utf8');
  assert.ok(all.includes('"note":"new"') && !all.includes('"note":"old"') && all.includes('"note":"only"') && all.includes('"note":"g"'));
});

test('without GitHub digests the backup is proved by a second download', () => {
  const {priv, pub, work, store} = setup(), log = [];
  compactRelease(fakeGh(store, {noDigest: true}), {repo: 'r/r', tag: 'net-records', backupTag: 'b', work, privKeyFile: priv, pubKey: pub, stamp: 's', retry: f => f(), log: l => log.push(l)});
  assert.ok(log.some(l => /a second download/.test(l)));
});

test('a backup that differs stops everything: the live release is untouched', () => {
  const {priv, pub, work, live, store} = setup(), before = fs.readdirSync(live).sort();
  assert.throws(() => compactRelease(fakeGh(store, {corruptBackup: true}), {repo: 'r/r', tag: 'net-records', backupTag: 'net-records-backup-x', work, privKeyFile: priv, pubKey: pub, stamp: 's', retry: f => f()}), /sha256 differs/);
  assert.deepEqual(fs.readdirSync(live).sort(), before);
});

test('a bundle the key cannot open stops everything: nothing is removed', () => {
  const {pub, work, live, store} = setup(), wrong = keys().priv, before = fs.readdirSync(live).sort();
  assert.throws(() => compactRelease(fakeGh(store), {repo: 'r/r', tag: 'net-records', backupTag: 'b', work, privKeyFile: wrong, pubKey: pub, stamp: 's', retry: f => f()}));
  assert.deepEqual(fs.readdirSync(live).sort(), before);
});

test('routine mode (no backup): an asset published while it runs is kept', () => {
  const {priv, pub, work, live, store} = setup(), extra = path.join(tmp(), 'net-records-late.tgz.enc');
  fs.writeFileSync(extra, 'late');
  let added = false;
  const gh = fakeGh(store, {onUpload: (tag) => { if (tag === 'net-records' && !added) { added = true; fs.copyFileSync(extra, path.join(live, 'net-records-late.tgz.enc')); fs.writeFileSync(path.join(live, 'net-records-late.k.enc'), 'k'); } }});
  const result = compactRelease(gh, {repo: 'r/r', tag: 'net-records', backupTag: '', work, privKeyFile: priv, pubKey: pub, stamp: 's', retry: f => f()});
  assert.equal(result.rows, 3);
  assert.deepEqual(fs.readdirSync(live).sort(), ['net-records-late.k.enc', 'net-records-late.tgz.enc', 'net-records-s-c1.k.enc', 'net-records-s-c1.tgz.enc']);
});

test('--dry changes nothing', () => {
  const {priv, pub, work, live, store} = setup(), before = fs.readdirSync(live).sort();
  const result = compactRelease(fakeGh(store), {repo: 'r/r', tag: 'net-records', backupTag: '', work, privKeyFile: priv, pubKey: pub, dry: true, stamp: 's', retry: f => f()});
  assert.equal(result.rows, 3);
  assert.deepEqual(fs.readdirSync(live).sort(), before);
});

// One encrypted records bundle: pack row folders, encrypt them with the repo's public key, and open them again with the private key (records-publish.mjs, records-compact.mjs).
// A bundle is two release files: <name>.tgz.enc (AES-256 of a tar.gz) and <name>.k.enc (its random key, RSA-OAEP with desktop/e2e/net-record.pub.pem). Guard: e2e/test/records-compact.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const openssl = (args, cwd) => execFileSync('openssl', args, {cwd, stdio: ['ignore', 'pipe', 'inherit']});

// rowDirs: [{dir, as}] copied into <work>/<name>/<as>; -> {bundle, key} file names inside `work`. The tar.gz and the plain key are removed.
export function packBundle(work, name, rowDirs, pubKey) {
  const stage = path.join(work, 'stage-' + name);
  fs.rmSync(stage, {recursive: true, force: true});
  for (const {dir, as} of rowDirs) fs.cpSync(dir, path.join(stage, as), {recursive: true});
  const bundle = `${name}.tgz.enc`, key = `${name}.k.enc`;
  execFileSync('tar', ['czf', `${name}.tgz`, '-C', stage, '.'], {cwd: work});
  openssl(['rand', '-hex', '-out', `${name}.k`, '32'], work);   // hex: a pass file's first line is the password (a raw key can start with a newline)
  openssl(['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', `${name}.tgz`, '-out', bundle, '-pass', `file:${name}.k`], work);
  openssl(['pkeyutl', '-encrypt', '-pubin', '-inkey', pubKey, '-pkeyopt', 'rsa_padding_mode:oaep', '-in', `${name}.k`, '-out', key], work);
  for (const gone of [`${name}.k`, `${name}.tgz`]) fs.rmSync(path.join(work, gone));
  fs.rmSync(stage, {recursive: true, force: true});
  return {bundle, key};
}

// Opens <dir>/<name>.k.enc + <name>.tgz.enc into <into>. Throws when the key does not open it (a caller that deletes anything must not go on).
export function openBundle(dir, name, privKeyFile, into) {
  const k = path.join(into, `.${name}.k`), tgz = path.join(into, `.${name}.tgz`);
  fs.mkdirSync(into, {recursive: true});
  try {
    openssl(['pkeyutl', '-decrypt', '-inkey', privKeyFile, '-pkeyopt', 'rsa_padding_mode:oaep', '-in', path.join(dir, `${name}.k.enc`), '-out', k]);
    openssl(['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', path.join(dir, `${name}.tgz.enc`), '-out', tgz, '-pass', `file:${k}`]);
    execFileSync('tar', ['xzf', tgz, '-C', into], {stdio: ['ignore', 'ignore', 'inherit']});
  } finally { fs.rmSync(k, {force: true}); fs.rmSync(tgz, {force: true}); }
}

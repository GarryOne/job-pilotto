// Compacts the `net-records` release of the private repo into 1-2 bundles (lib/records-compact.mjs):
//   node records-compact.mjs [--dry] [--backup <tag>]     --backup net-records-backup-20261017: copy every asset there first and verify (the one-off); without it, the routine merge after a publish.
// Needs the private key (NET_RECORD_KEY, base64 of the PEM, or the Keychain item job-pilotto.capture.key) and a token that writes the private repo (GH_TOKEN / the gh login).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {compactRelease} from './lib/records-compact.mjs';

const here = path.dirname(new URL(import.meta.url).pathname), args = process.argv.slice(2);
const at = args.indexOf('--backup'), backupTag = at >= 0 ? args[at + 1] : '';
if (at >= 0 && !backupTag) { console.error('usage: node records-compact.mjs [--dry] [--backup <tag>]'); process.exit(2); }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-compact-')), privKeyFile = path.join(work, 'key.pem');
try {
  let key = process.env.NET_RECORD_KEY || '';
  if (!key && !process.env.CI) { try { key = execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.capture.key', '-w'], {encoding: 'utf8'}).trim(); } catch { /* no Keychain item */ } }
  if (!key) { console.error('records-compact: no private key (NET_RECORD_KEY or the Keychain item job-pilotto.capture.key): nothing was changed'); process.exit(2); }
  fs.writeFileSync(privKeyFile, Buffer.from(key, 'base64'), {mode: 0o600});
  const gh = argv => execFileSync('gh', argv, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28});
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const result = compactRelease(gh, {repo: process.env.NET_RECORDS_REPO || 'GarryOne/job-pilotto-internal', tag: 'net-records', backupTag, work, privKeyFile, pubKey: path.join(here, 'net-record.pub.pem'), dry: args.includes('--dry'), stamp, log: line => console.log(`records-compact: ${line}`)});
  console.log(`records-compact: ${result.before} assets -> ${result.after} (${result.rows} rows)`);
} catch (error) { console.error(`records-compact: FAILED, the release is as it was unless the line above says otherwise: ${error.message}`); process.exitCode = 1; }
finally { fs.rmSync(work, {recursive: true, force: true}); }

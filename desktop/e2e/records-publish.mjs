// Publishes this Mac's pool network records for the PR replay (.github/workflows/replay-offline.yml): the newest record per row in <records dir> is packed,
// encrypted with the repo's public key (desktop/e2e/net-record.pub.pem: only the owner's Keychain key and the NET_RECORD_KEY secret open it) and put on the
// GitHub release `net-records` of the PRIVATE repo job-pilotto-internal (owner, 14 Oct 2026; CI reads it with NET_RECORDS_READ_TOKEN, net-records-fetch.sh), replacing the
// last set. Re-recording is by hand on the Mac (owner, 13 Oct 2026).
//   node records-publish.mjs <records dir> [--dry]      (record a row: JP_NET_RECORD_DIR=<records dir> npm run smoke -- --only "<row>")
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {newestPerRow} from './replay-records.mjs';
import {stampZone} from './lib/replay-date.mjs';

export const TAG = 'net-records', BUNDLE = 'net-records.tgz.enc', KEY = 'net-records.k.enc', REPO = process.env.NET_RECORDS_REPO || 'GarryOne/job-pilotto-internal';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [root] = process.argv.slice(2), dry = process.argv.includes('--dry');
  if (!root) { console.error('usage: node records-publish.mjs <records dir> [--dry]'); process.exit(2); }
  const rows = newestPerRow(root), here = path.dirname(new URL(import.meta.url).pathname), work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-records-'));
  try {
    const stage = path.join(work, 'net-records');
    for (const row of rows) {
      const into = path.join(stage, path.basename(row.dir)), file = path.join(into, 'record.json');
      fs.cpSync(row.dir, into, {recursive: true});
      const record = JSON.parse(fs.readFileSync(file, 'utf8')), stamped = stampZone(record);   // a Mac record from before the zone was saved: this Mac's zone
      if (stamped !== record) fs.writeFileSync(file, JSON.stringify(stamped));
    }
    console.log(`records-publish: ${rows.length} rows: ${rows.map(row => row.name).join(', ')}`);
    if (dry || !rows.length) process.exit(0);
    const run = (cmd, args) => execFileSync(cmd, args, {cwd: work, stdio: ['ignore', 'pipe', 'inherit']});
    const gh = args => execFileSync('gh', args, {cwd: here, stdio: ['ignore', 'pipe', 'inherit']});   // from the repo: gh finds which repo the release is on
    run('tar', ['czf', 'net.tgz', 'net-records']);
    run('openssl', ['rand', '-out', 'k', '32']);
    run('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', 'net.tgz', '-out', BUNDLE, '-pass', 'file:k']);
    run('openssl', ['pkeyutl', '-encrypt', '-pubin', '-inkey', path.join(here, 'net-record.pub.pem'), '-pkeyopt', 'rsa_padding_mode:oaep', '-in', 'k', '-out', KEY]);
    fs.rmSync(path.join(work, 'k')); fs.rmSync(path.join(work, 'net.tgz'));
    try { gh(['release', 'view', TAG, '-R', REPO]); } catch { gh(['release', 'create', TAG, '-R', REPO, '--prerelease', '--title', 'Pool network records (encrypted)', '--notes', 'Encrypted pool network records for the PR replay (desktop/e2e/records-publish.mjs). Not an app build.']); }
    gh(['release', 'upload', TAG, '-R', REPO, path.join(work, BUNDLE), path.join(work, KEY), '--clobber']);
    console.log(`records-publish: ${rows.length} rows uploaded to ${REPO} release ${TAG}`);
    // New recordings: main's replay runs again at once, so /admin/applying shows them (the workflow publishes from main only).
    try { gh(['workflow', 'run', 'CI · Replay vs live (offline)', '--ref', 'main']); console.log('records-publish: replay on main started'); } catch { console.log('records-publish: start the replay on main by hand (gh workflow run "CI · Replay vs live (offline)" --ref main)'); }
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}

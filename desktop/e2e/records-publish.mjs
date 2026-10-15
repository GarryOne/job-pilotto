// Publishes this Mac's pool network records for the PR replay (.github/workflows/site-replays.yml): the newest record per row in <records dir> is packed,
// encrypted with the repo's public key (desktop/e2e/net-record.pub.pem: only the owner's Keychain key and the NET_RECORD_KEY secret open it) and put on the
// GitHub release `net-records` of the PRIVATE repo job-pilotto-internal (owner, 14 Oct 2026; CI reads it with NET_RECORDS_READ_TOKEN, net-records-fetch.sh) as a NEW bundle
// beside the others (14 Oct 2026: a publish that replaced the set would have dropped 11 of 18 rows; adding needs only the public key). The reader keeps the newest record per row
// across bundles. Decrypting (to edit a record's answers): the Keychain item job-pilotto.capture.key. Re-recording is by hand on the Mac (owner, 13 Oct 2026).
//   node records-publish.mjs <records dir> [--dry]      (record a row: JP_NET_RECORD_DIR=<records dir> npm run record-sites -- --only "<row>")
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {newestPerRow} from './replay-records.mjs';
import {stampZone} from './lib/replay-date.mjs';
import {judgeRecords, report} from './lib/record-guard.mjs';
import {load as loadPins, pinned as pinnedRows} from './lib/replay-ratchet.mjs';

// One bundle's two assets, named by when it was published: net-records-<UTC stamp>.tgz.enc and .k.enc (the first set, before 14 Oct, is net-records.tgz.enc).
export const bundleNames = (date = new Date()) => { const stamp = date.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; return {bundle: `net-records-${stamp}.tgz.enc`, key: `net-records-${stamp}.k.enc`}; };
export const TAG = 'net-records', REPO = process.env.NET_RECORDS_REPO || 'GarryOne/job-pilotto-internal';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [root] = process.argv.slice(2), dry = process.argv.includes('--dry');
  if (!root) { console.error('usage: node records-publish.mjs <records dir> [--dry]'); process.exit(2); }
  const {bundle: BUNDLE, key: KEY} = bundleNames();
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
    const flagValues = name => process.argv.flatMap((arg, at) => (arg === name ? [process.argv[at + 1]] : []));
    if (rows.length > 3 && !process.env.CI) { console.error(`records-publish: refused: ${rows.length} rows at once; the guard replays each one and more than 3 replay in CI. Publish at most 3 rows a time (a folder with only those rows).`); process.exit(1); }
    const replayOf = (from, name) => {   // one row's own replay on this Mac (replay-records.mjs, JP_REPLAY_ONLY): its fidelity record, or null
      const out = fs.mkdtempSync(path.join(work, 'guard-'));
      execFileSync(process.execPath, [path.join(here, 'replay-records.mjs'), from, out], {env: {...process.env, JP_REPLAY_ONLY: name, JP_WIDE_LOCAL: ''}, stdio: ['ignore', 'ignore', 'inherit']});
      const files = fs.existsSync(path.join(out, 'step4')) ? fs.readdirSync(path.join(out, 'step4')) : [];
      return files.length ? JSON.parse(fs.readFileSync(path.join(out, 'step4', files[0]), 'utf8')) : null;
    };
    const against = flagValues('--against')[0], released = against ? new Map(newestPerRow(against).map(row => [row.name, row])) : null;
    const judged = judgeRecords(rows.map(row => ({name: row.name, dir: row.dir, replay: replayOf(root, row.name), replaced: released ? (released.has(row.name) ? replayOf(against, row.name) : null) : undefined})), {pins: pinnedRows(loadPins()), accepts: flagValues('--accept')});
    if (judged.refusals.length || judged.notes.length) console.error(report(judged));
    if (judged.refusals.length) { console.error(`records-publish: refused: ${judged.refusals.length} problem(s); nothing was uploaded.`); process.exit(1); }
    if (dry || !rows.length) process.exit(0);
    const run = (cmd, args) => execFileSync(cmd, args, {cwd: work, stdio: ['ignore', 'pipe', 'inherit']});
    const gh = args => execFileSync('gh', args, {cwd: here, stdio: ['ignore', 'pipe', 'inherit']});   // from the repo: gh finds which repo the release is on
    run('tar', ['czf', 'net.tgz', 'net-records']);
    run('openssl', ['rand', '-out', 'k', '32']);
    run('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', 'net.tgz', '-out', BUNDLE, '-pass', 'file:k']);
    run('openssl', ['pkeyutl', '-encrypt', '-pubin', '-inkey', path.join(here, 'net-record.pub.pem'), '-pkeyopt', 'rsa_padding_mode:oaep', '-in', 'k', '-out', KEY]);
    fs.rmSync(path.join(work, 'k')); fs.rmSync(path.join(work, 'net.tgz'));
    try { gh(['release', 'view', TAG, '-R', REPO]); } catch { gh(['release', 'create', TAG, '-R', REPO, '--prerelease', '--title', 'Pool network records (encrypted)', '--notes', 'Encrypted pool network records for the PR replay (desktop/e2e/records-publish.mjs). Not an app build.']); }
    gh(['release', 'upload', TAG, '-R', REPO, path.join(work, BUNDLE), path.join(work, KEY)]);   // added, never --clobber: other bundles stay
    console.log(`records-publish: ${rows.length} rows added to ${REPO} release ${TAG} as ${BUNDLE}`);
    // New recordings: main's replay runs again at once, so /admin/lab-form-filling shows them (the workflow publishes from main only).
    try { gh(['workflow', 'run', 'CI · Site replays · all (offline)', '--ref', 'main']); console.log('records-publish: replay on main started'); } catch { console.log('records-publish: start the replay on main by hand (gh workflow run "CI · Site replays · all (offline)" --ref main)'); }
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}

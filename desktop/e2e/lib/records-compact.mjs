// Keeps the `net-records` release small: backs every asset up to a separate release (count + sha256 checked), repacks the newest record per row into 1-2 bundles, uploads them,
// and only then removes the old assets (owner, 17 Oct 2026: 207 assets / 578 MB used up GitHub's 5,000 calls/hour on every PR push). `gh` is injected: gh(args) -> stdout, throws on failure.
// Guard: e2e/test/records-compact.test.mjs (a fake release).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {newestPerRow} from '../replay-records.mjs';
import {openBundle, packBundle} from './records-pack.mjs';
import {uploadBundle, withRetry} from './refill-resilience.mjs';

export const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const listAssets = (gh, repo, tag) => JSON.parse(gh(['release', 'view', tag, '-R', repo, '--json', 'assets'])).assets || [];
const hasRelease = (gh, repo, tag) => { try { gh(['release', 'view', tag, '-R', repo]); return true; } catch { return false; } };
const hashes = dir => new Map(fs.readdirSync(dir).filter(name => !name.startsWith('.')).map(name => [name, sha256(path.join(dir, name))]));
const dirBytes = dir => fs.readdirSync(dir, {withFileTypes: true}).reduce((sum, e) => sum + (e.isDirectory() ? dirBytes(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);

// Copies every asset of `tag` to the release `backupTag` (created as a pre-release), then proves it: same count, same names, same sha256 (the asset's own digest when GitHub gives one, else a download).
// Returns the live assets. Throws, changing nothing live, on any difference.
export function backupRelease(gh, {repo, tag, backupTag, work, retry = withRetry, log = () => {}}) {
  const live = listAssets(gh, repo, tag), from = path.join(work, 'live');
  fs.mkdirSync(from, {recursive: true});
  gh(['release', 'download', tag, '-R', repo, '--pattern', '*', '--dir', from, '--clobber']);
  const local = hashes(from);
  if (local.size !== live.length) throw new Error(`backup: downloaded ${local.size} of ${live.length} assets`);
  if (!hasRelease(gh, repo, backupTag)) gh(['release', 'create', backupTag, '-R', repo, '--prerelease', '--title', `Backup of ${tag}`, '--notes', `All assets of the release ${tag} before it was compacted (records-compact.mjs). Not an app build.`]);
  const there = new Set(listAssets(gh, repo, backupTag).map(a => a.name)), todo = [...local.keys()].filter(name => !there.has(name));
  for (let at = 0; at < todo.length; at += 10) retry(() => gh(['release', 'upload', backupTag, '-R', repo, ...todo.slice(at, at + 10).map(name => path.join(from, name))]));
  log(`backup: ${todo.length} uploaded, ${local.size - todo.length} already there`);
  const saved = listAssets(gh, repo, backupTag);
  if (saved.length !== live.length || live.some(a => !saved.find(b => b.name === a.name))) throw new Error(`backup: ${saved.length} assets on ${backupTag}, ${live.length} on ${tag}`);
  const withDigest = saved.every(a => /^sha256:/.test(a.digest || ''));
  let theirs;
  if (withDigest) theirs = new Map(saved.map(a => [a.name, a.digest.slice(7)]));
  else { const back = path.join(work, 'backup'); fs.mkdirSync(back, {recursive: true}); gh(['release', 'download', backupTag, '-R', repo, '--pattern', '*', '--dir', back, '--clobber']); theirs = hashes(back); }
  for (const [name, hash] of local) if (theirs.get(name) !== hash) throw new Error(`backup: sha256 differs for ${name}`);
  log(`backup: ${saved.length} assets on ${backupTag}, count and sha256 verified (${withDigest ? "GitHub's digest" : 'a second download'})`);
  return live;
}

// The bundles on a release: every <name>.tgz.enc with its <name>.k.enc beside it. An asset that is neither half of a pair is named, never silently dropped.
export function bundlesOf(assets) {
  const names = new Set(assets.map(a => a.name)), part = n => n.replace(/\.(tgz|k)\.enc$/, '');
  const isTgz = n => n.endsWith('.tgz.enc'), isKey = n => n.endsWith('.k.enc');
  const bundles = [...names].filter(n => isTgz(n) && names.has(`${part(n)}.k.enc`)).map(part);
  // A half pair (an upload cut short: a key with no data, or data with no key) holds no record a reader can open: it is backed up with everything else, then removed with the old assets.
  const orphans = [...names].filter(n => (isTgz(n) && !names.has(`${part(n)}.k.enc`)) || (isKey(n) && !names.has(`${part(n)}.tgz.enc`)));
  const odd = [...names].filter(n => !isTgz(n) && !isKey(n));
  return {bundles, orphans, odd};
}

// Decrypts `bundles` (downloaded into `enc`) into <root>/<bundle>/ and returns the newest record per row, split into bins of at most maxBytes (uncompressed) -> [[{dir, as}]].
export function newestBins({enc, bundles, privKeyFile, root, maxBytes = 1.2e9}) {
  for (const name of bundles) openBundle(enc, name, privKeyFile, path.join(root, name));
  const rows = newestPerRow(root), bins = [];
  rows.forEach((row, at) => {
    const size = dirBytes(row.dir), item = {dir: row.dir, as: `${String(at).padStart(3, '0')}-${path.basename(row.dir)}`, size};
    const bin = bins.find(b => b.size + size <= maxBytes);
    if (bin) { bin.rows.push(item); bin.size += size; } else bins.push({rows: [item], size});
  });
  return {rows: rows.length, bins: bins.map(b => b.rows)};
}

// The whole job. dry: builds and reports, uploads and deletes nothing. backupTag: copy every asset there first (the one-off compaction); falsy: skip (the routine merge after a publish).
// Order is fixed: backup verified -> new bundles uploaded and seen on the release -> only the assets listed at the START are removed (a publish that landed meanwhile stays).
export function compactRelease(gh, {repo, tag, backupTag, work, privKeyFile, pubKey, dry = false, stamp, retry = withRetry, log = () => {}, maxBytes}) {
  const live = backupTag ? backupRelease(gh, {repo, tag, backupTag, work, retry, log}) : listAssets(gh, repo, tag), enc = path.join(work, 'live');
  if (!backupTag) { fs.mkdirSync(enc, {recursive: true}); gh(['release', 'download', tag, '-R', repo, '--pattern', '*', '--dir', enc, '--clobber']); }
  const {bundles, orphans, odd} = bundlesOf(live);
  if (odd.length) throw new Error(`compact: assets that are not a bundle file, left alone: ${odd.join(', ')}`);
  const {rows, bins} = newestBins({enc, bundles, privKeyFile, root: path.join(work, 'plain'), maxBytes});
  if (orphans.length) log(`compact: half pairs (nothing a reader can open), backed up then removed: ${orphans.join(', ')}`);
  log(`compact: ${live.length} assets, ${bundles.length} bundles -> ${rows} rows in ${bins.length} bundle(s)`);
  if (!rows) throw new Error('compact: no record found in any bundle; nothing is removed');
  if (dry) return {before: live.length, after: bins.length * 2, rows};
  const made = bins.map((bin, at) => packBundle(work, `net-records-${stamp}-c${at + 1}`, bin, pubKey));
  for (const {bundle, key} of made) uploadBundle(file => gh(['release', 'upload', tag, '-R', repo, file]), path.join(work, bundle), path.join(work, key), retry);
  const seen = new Set(listAssets(gh, repo, tag).map(a => a.name));
  if (made.some(({bundle, key}) => !seen.has(bundle) || !seen.has(key))) throw new Error('compact: the new bundles are not on the release; nothing is removed');
  const fresh = new Set(made.flatMap(m => [m.bundle, m.key]));
  for (const asset of live) if (!fresh.has(asset.name)) retry(() => gh(['release', 'delete-asset', tag, asset.name, '-R', repo, '-y']));
  const after = listAssets(gh, repo, tag).length;
  log(`compact: ${live.length} assets -> ${after}`);
  return {before: live.length, after, rows};
}

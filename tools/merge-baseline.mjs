// A git merge driver for desktop/e2e/ladder-baseline.json: two sessions that each updated the baseline for their own fixtures merge
// without a rebase conflict (11 Oct 2026 post-mortems: a conflict twice per fix, then a full re-run of --update-baseline).
// Per fixture and per prompt-fingerprint key, a three-way merge: the side that changed wins; both changed the SAME entry differently = a
// real conflict (exit 1, git stops as before). Reasons: the union, in order. Wired by .gitattributes (merge=ladder-baseline) and tools/ship.sh
// (git config merge.ladder-baseline.driver). Guard: desktop/test/merge-baseline.test.js; the ratchet test still checks the merged file.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One map merged key by key; returns {merged, conflicts: [key…]}.
function mergeMap(base = {}, ours = {}, theirs = {}) {
  const merged = {}, conflicts = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const o = base[key], a = ours[key], b = theirs[key];
    let pick;
    if (same(a, b)) pick = a;
    else if (same(a, o)) pick = b;
    else if (same(b, o)) pick = a;
    else { conflicts.push(key); pick = a; }
    if (pick !== undefined) merged[key] = pick;
  }
  return {merged, conflicts};
}

export function mergeBaselines(base, ours, theirs) {
  const fixtures = mergeMap(base.fixtures, ours.fixtures, theirs.fixtures);
  const prompts = mergeMap(base.promptFingerprint, ours.promptFingerprint, theirs.promptFingerprint);
  const seen = new Set(), reasons = [];
  for (const r of [...(ours.reasons || []), ...(theirs.reasons || [])]) { const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); reasons.push(r); } }
  const conflicts = [...fixtures.conflicts.map(k => `fixture ${k}`), ...prompts.conflicts.map(k => `prompt ${k}`)];
  if (!same(ours.schemaVersion, theirs.schemaVersion)) conflicts.push('schemaVersion');
  const merged = {schemaVersion: ours.schemaVersion, reasons, ...(Object.keys(prompts.merged).length ? {promptFingerprint: prompts.merged} : {}), fixtures: fixtures.merged};
  return {merged, conflicts};
}

// git calls: node tools/merge-baseline.mjs %O %A %B  (the result is written to %A)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [basePath, oursPath, theirsPath] = process.argv.slice(2);
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const base = read(basePath) || {}, ours = read(oursPath), theirs = read(theirsPath);
  if (!ours || !theirs) process.exit(1);
  const {merged, conflicts} = mergeBaselines(base, ours, theirs);
  if (conflicts.length) { console.error(`ladder baseline: both sides changed ${conflicts.join(', ')}: resolve by hand, then npm run ladder-score -- --offline --update-baseline "<why>"`); process.exit(1); }
  fs.writeFileSync(oursPath, `${JSON.stringify(merged, null, 1)}\n`);
  console.error('ladder baseline: merged both sides (tools/merge-baseline.mjs)');
}

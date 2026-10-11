// The proof behind `npm run row-to-case -- "<row>" <case>` (skill fix-failing-forms): a pool row's capture becomes a case in the recorded cases folder ONLY when it proves itself.
//   1. the capture is built into a staging folder (lib/row-case.mjs: scrubbed, shrunk, privacy and size gates);
//   2. --ask-cold: the NEW build's model calls the case does not keep yet are asked ONCE on the plan path and kept in the case's memo (a prompt change makes new asks; CI has no claude -p);
//   3. the NEW build replays it with no cold ask; its signature (page kinds, presses, per-field outcome and reason) against the LIVE run's gives `expect` (lib/row-signature.mjs): the tool's, never the fixer's;
//   4. the OLD build (--old <extension folder>) must replay the live run's page kinds and presses (else the case is not the live run) and must FAIL the case (else exit 3, as recorded-both).
// Exit codes: 0 written; 1 the new build fails its own case; 2 refused before replaying (gates, an existing case, no old build); 3 the old build passes (the control proves nothing); 4 not provable
// (a cold ask is left, nothing improved, a regression, the old build does not replay the live run). -> {code, lines}; nothing reaches the cases folder unless code is 0. Guard: e2e/test/row-to-case.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appProfileTexts, personalValues, scrub} from './capture-page.mjs';
import {buildCase} from './row-case.mjs';
import {runRowCase} from './row-case-run.mjs';
import {replayRow} from './row-replay.mjs';
import {baselineSignature, expectFrom, signatureOf} from './row-signature.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export async function rowToCase({rowDir, name, outDir, oldDir, askCold = false, build = buildCase, replay = replayRow, values = personalValues(appProfileTexts())}) {
  const lines = [], end = (code, line) => { lines.push(line); return {code, lines}; };
  if (!oldDir) return end(2, 'row-to-case: name the OLD build (the fix\'s parent): --old <extension folder> (a case that cannot fail on the old build proves nothing)');
  if (fs.existsSync(path.join(outDir, name))) return end(2, `row-to-case: ${path.join(outDir, name)} exists; pick a new case name (an old case is never overwritten)`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-to-case-'));
  try {
    let built;
    try { built = await build({rowDir, name, outDir: staging, values}); } catch (error) { return end(2, `row-to-case: ${error.message}`); }
    const caseFile = path.join(built.dir, 'case.json'), memoFile = path.join(built.dir, 'model-memo.json'), item = readJson(caseFile), asCase = expect => ({...item, name, dir: built.dir, expect});
    if (askCold) {   // the new build's cold asks, once, on the plan path (the offline app is the fake applicant; no API key); kept scrubbed beside their part hashes
      const cold = await replay(built.dir, {ask: true});
      fs.writeFileSync(memoFile, scrub(JSON.stringify({...readJson(memoFile), ...(cold.memoAfter || {})}), values));
      lines.push('row-to-case: the new build\'s model calls were asked once and kept in the case\'s memo');
    }
    const volatileKept = Object.entries(readJson(memoFile)).filter(([name]) => name.endsWith('#volatile')).flatMap(([, parts]) => parts);
    if (volatileKept.length) lines.push(`row-to-case: WARNING: a kept ask carries a clock time or a date in ${[...new Set(volatileKept)].join(', ')}: no memo can match it again; fix it at the source (a prompt carries no time)`);
    const fresh = await replay(built.dir, {});
    if (fresh.misses) return end(4, `row-to-case: ${fresh.misses} model ask(s) of the new build are not in the case's kept answers (CI has no claude -p): run again with --ask-cold${fresh.missParts?.length ? ` (the nearest kept ask differs in ${fresh.missParts.join(', ')})` : ''}`);
    const base = baselineSignature(item.baseline), derived = expectFrom(base, signatureOf(fresh));
    if (derived.refused) return end(4, `row-to-case: ${derived.refused}`);
    const withExpect = asCase(derived.expect);
    // The OLD build: it must fail the case (else the control proves nothing) and replay the live run (else this case is not that run).
    const old = await runRowCase(withExpect, {extensionDir: oldDir, replay});
    if (old.ok) return end(3, 'row-to-case: the OLD build passes this case: the control proves nothing; nothing written');
    if (old.signature.kinds.join() !== base.kinds.join() || old.signature.pressed.join() !== base.pressed.join()) {
      return end(4, `row-to-case: the old build (${oldDir}) does not replay the live run: page kinds ${old.signature.kinds.join(', ') || 'none'} (live ${base.kinds.join(', ') || 'none'}), presses ${old.signature.pressed.join(', ') || 'none'} (live ${base.pressed.join(', ') || 'none'})`);
    }
    lines.push(`row-to-case: the old build fails it as it must: ${old.failures.join('; ').slice(0, 300)}`);
    const own = await runRowCase(withExpect, {replay});
    if (!own.ok) return end(1, `row-to-case: the new build fails its own case: ${own.failures.join('; ')}`);
    fs.writeFileSync(caseFile, `${JSON.stringify({...item, expect: derived.expect}, null, 1)}\n`);
    fs.cpSync(built.dir, path.join(outDir, name), {recursive: true});
    lines.push(`row-to-case: ${name} written (${Math.round(built.bytes / 1024)} KB, ${built.verdict}); expect: ${JSON.stringify(derived.expect)}`);
    return {code: 0, lines};
  } finally { fs.rmSync(staging, {recursive: true, force: true}); }
}

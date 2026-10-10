// Replay candidates (owner, 10 Oct 2026, after a form filled 4 of 13 and nothing was kept to fix it from): when a nightly smoke run fails, its final page is saved, scrubbed, with what the run saw, as
// the start of a fixed-site replay. It owns: which results are worth saving, and the folder written per failing shape. Used by smoke.mjs after each site; the page itself is snapshotted in the live
// run (apply-live.mjs, structure only, scrubbed). The folder is on this Mac (<QA folder>/replay-candidates/<day>/<shape>/), never the public repo: a person promotes a candidate to
// desktop/e2e/recorded/ only when they fix the shape, with the AI answers of the failing run, and it must fail on the build before the fix (skill fix-failing-forms). Guard: test/replay-candidate.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

// A failure worth keeping: a form reached with a shortfall, or a run that stopped before the form (not a documented hold: a code or bot check, nor a posting gone).
export const worthSaving = result => !!result && !result.note && (!!result.short || ['none', 'posting', 'account'].includes(result.reached));

export const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';

// Writes <dir>/<day>/<slug>/{page.html, case.json}; returns the folder, or null when there is no page. The address keeps no query or fragment.
export function saveCandidate({dir, day, shape, result, html, output = ''}) {
  if (!html || !worthSaving(result)) return null;
  const folder = path.join(dir, day, slug(shape)), address = String(result.url || '').replace(/[?#].*$/, '');
  fs.mkdirSync(folder, {recursive: true});
  fs.writeFileSync(path.join(folder, 'page.html'), html);
  const pageKinds = String(output).split('\n').filter(line => /page kind/.test(line)).map(line => line.trim().slice(0, 400)).slice(0, 20);
  const item = {
    shape: `${shape}: ${result.short ? `a form reached with ${result.short.done} of ${result.short.total} asked fields filled` : `a run that stopped at the ${result.reached}`} (auto-saved, TODO: the shape in words)`,
    why: `auto-saved by the smoke run of ${day}: reached ${result.reached}${result.filled != null ? `, ${result.filled} filled, ${result.left} left` : ''}`,
    sample: address ? new URL(address).host : '',
    pages: [{url: address, file: 'page.html'}],
    ai: {},   // TODO when promoted: the AI's real answers of the failing run (from evidence.pageKinds), never written to fit a fix
    expect: {},
    run: {day, reached: result.reached, filled: result.filled, left: result.left, short: result.short || null, path: result.path || [], fields: result.fieldList || []},
    evidence: {pageKinds},
  };
  fs.writeFileSync(path.join(folder, 'case.json'), `${JSON.stringify(item, null, 1)}\n`);
  return folder;
}

// Keeps the day's folder to the failing shapes of today's runs only (a shape that passed on a later run drops its older candidate).
export function dropCandidate({dir, day, shape}) { fs.rmSync(path.join(dir, day, slug(shape)), {recursive: true, force: true}); }

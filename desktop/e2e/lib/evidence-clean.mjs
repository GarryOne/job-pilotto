// What the evidence folder keeps (owner, 14 Oct 2026: 525 pictures, 360 MB in 5 days, never cleaned; end.png opened 60 times, step pictures 12): end.png of every run;
// step pictures only of a run whose row needs a fix or is a site problem; day folders older than 14 days removed at the start of a smoke run. Guard: test/evidence-clean.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {rowStatus} from '../../../site/src/applying-status.js';
import {stepFilesIn} from './step-shots.mjs';

export const KEEP_DAYS = 14;
// A run's step pictures are kept only when the row ends "needs a fix" or "site problem" (the pool's own status words, site/src/applying-status.js); a row that works or is held on purpose keeps end.png only.
export const keepsSteps = run => ['fix', 'site'].includes(rowStatus(run).state);

// Removes the step pictures of a bundle folder (and of its electron/ leg). -> how many files.
export function dropSteps(folder) {
  let removed = 0;
  for (const where of [folder, path.join(folder, 'electron')]) for (const name of stepFilesIn(where)) { fs.rmSync(path.join(where, name)); removed++; }
  return removed;
}

// At the start of a smoke run: the day folders (YYYY-MM-DD) of `dir` older than KEEP_DAYS go. Only the evidence folder itself is touched: any other dir is refused. -> the folders removed.
export function removeOldEvidence(dir, now = new Date(), log = console.log) {
  if (path.basename(dir) !== 'evidence') throw new Error(`not an evidence folder: ${dir}`);
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const old = names.filter(name => /^\d{4}-\d\d-\d\d$/.test(name) && name < cutoff);
  for (const name of old) fs.rmSync(path.join(dir, name), {recursive: true, force: true});
  log(`evidence: removed ${old.length} folders older than ${KEEP_DAYS} days`);
  return old;
}

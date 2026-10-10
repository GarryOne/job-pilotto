// The ladder ratchet's baseline (e2e/ladder-baseline.json): each fixture's expectation, the outcome its stored answer gives and its status, plus a dated reason for every update. compareToBaseline says
// what got worse (a fail), better (reported), was added or removed, or had its expectation edited (each needs a baseline update with a reason). Guard: test/ladder-ratchet.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RANK} from './ladder-score.mjs';

export const BASELINE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ladder-baseline.json');
export const readBaseline = (file = BASELINE_FILE) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {schemaVersion: 1, reasons: [], fixtures: {}}; } };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function compareToBaseline(allRows, baseline) {
  const rows = allRows.filter(row => row.status !== 'pending');   // a pending fixture (a captured candidate nobody confirmed yet) is outside the ratchet
  const kept = baseline.fixtures || {}, ids = new Set(rows.map(row => row.id));
  const verdict = {worse: [], better: [], added: [], removed: Object.keys(kept).filter(id => !ids.has(id)), changedExpectation: []};
  for (const row of rows) {
    const was = kept[row.id];
    if (!was) { verdict.added.push(row.id); continue; }
    if (!same(was.expect, {outcome: row.expected, accept: row.accept})) verdict.changedExpectation.push(row.id);
    if (RANK[row.status] > RANK[was.status]) verdict.worse.push({id: row.id, was: was.status, now: row.status});
    else if (RANK[row.status] < RANK[was.status]) verdict.better.push({id: row.id, was: was.status, now: row.status});
  }
  return verdict;
}

// A baseline from the rows now, with the reason appended to the old list.
export function nextBaseline(allRows, old, reason, today = new Date().toISOString().slice(0, 10), promptFingerprint = old.promptFingerprint) {
  const rows = allRows.filter(row => row.status !== 'pending');
  const fixtures = Object.fromEntries(rows.map(row => [row.id, {...(row.question && row.question !== 'page_kind' ? {question: row.question} : {}), expect: {outcome: row.expected, accept: row.accept}, outcome: row.outcome, status: row.status}]));
  return {schemaVersion: 1, reasons: [...(old.reasons || []), {date: today, reason}], ...(promptFingerprint ? {promptFingerprint} : {}), fixtures};
}

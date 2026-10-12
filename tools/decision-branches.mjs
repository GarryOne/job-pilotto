#!/usr/bin/env node
// The decision-branch ratchet (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 3; owner, 12 Oct 2026: "a decision is data"): counts the page-kind/role conditions
// in the flow's decision code (extension/fill-flow.js consider(), extension/account-step.js accountStepOnce()) and compares them with tools/decision-branches.json: the count may
// only go down. A new condition is data (a ladder fixture + prompt example, or a learned move), or the owner's OK said in the baseline's reason:
//   node tools/decision-branches.mjs                      the counts now, against the baseline
//   node tools/decision-branches.mjs --update "<why>"     rewrite the baseline with a dated reason; a RAISE needs "Decision-branch: <why> (owner's OK)"
// Guard: desktop/test/decision-branches.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PLACES = [
  {name: 'consider', file: 'extension/fill-flow.js', head: 'export async function consider('},
  {name: 'accountStep', file: 'extension/account-step.js', head: 'async function accountStepOnce('},
];
// A condition on what a page is or which step it is at: a role, a kind, a step, a mode or a judge's answer compared with one of our fixed words.
export const CONDITION = /\b(role|kind|step|accountStep|answer)(\?\.\w+|\.\w+)?\s*[!=]==?\s*'[a-z_-]+'/g;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_FILE = path.join(ROOT, 'tools/decision-branches.json');
export const RAISE = /^Decision-branch:\s*\S.{4,}/;

// The function's text from its head to its matching brace (comments out, so a comment may name a kind).
export function bodyOf(source, head) {
  const at = source.indexOf(head);
  if (at < 0) return '';
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && !--depth) return source.slice(at, i + 1).split('\n').map(line => line.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  }
  return '';
}
export const countIn = (source, head) => (bodyOf(source, head).match(CONDITION) || []).length;
export const counts = (root = ROOT) => Object.fromEntries(PLACES.map(place => [place.name, countIn(fs.readFileSync(path.join(root, place.file), 'utf8'), place.head)]));

// now, baseline: {consider, accountStep}. -> '' when equal, else what to do.
export function verdict(now, baseline = {}) {
  const up = PLACES.filter(place => now[place.name] > (baseline[place.name] ?? 0)).map(place => `${place.name} ${baseline[place.name] ?? 0} -> ${now[place.name]}`);
  if (up.length) return `a new page-kind/role condition in the flow's decision code (${up.join(', ')}): a decision is data: add a fixture or a learned move, or say why in "Decision-branch: <why>" (owner's OK): node tools/decision-branches.mjs --update "Decision-branch: <why>"`;
  const down = PLACES.filter(place => now[place.name] < (baseline[place.name] ?? 0)).map(place => `${place.name} ${baseline[place.name]} -> ${now[place.name]}`);
  return down.length ? `fewer decision branches (${down.join(', ')}): lock the gain: node tools/decision-branches.mjs --update "<why>"` : '';
}

// -> the next baseline, or throws when a raise has no owner's reason.
export function nextBaseline(now, before = {}, why = '', date = new Date().toISOString().slice(0, 10)) {
  if (!String(why).trim()) throw new Error('--update needs a reason');
  const raised = PLACES.some(place => now[place.name] > (before.counts?.[place.name] ?? 0));
  if (raised && before.counts && !RAISE.test(why)) throw new Error('a raise needs "Decision-branch: <why> (owner\'s OK)"');
  return {schemaVersion: 1, counts: now, reasons: [...(before.reasons || []), {date, reason: why}]};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now = counts(), before = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};
  const at = process.argv.indexOf('--update');
  if (at > 0) {
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(nextBaseline(now, before, process.argv[at + 1] || ''), null, 1)}\n`);
    console.log(`baseline written: ${JSON.stringify(now)}`);
  } else console.log(`${JSON.stringify(now)} (baseline ${JSON.stringify(before.counts || {})})${verdict(now, before.counts) ? `\n${verdict(now, before.counts)}` : ''}`);
}

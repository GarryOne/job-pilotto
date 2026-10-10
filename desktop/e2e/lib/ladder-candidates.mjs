// The pool run's replay candidates (~/Library/Application Support/Job Pilotto QA/replay-candidates/<day>/<shape>/{page.html,case.json}, written by the smoke run, read-only here) as ladder fixtures: a candidate whose run
// did NOT reach the form becomes a fixture with expect `pending` (a person confirms what the page really is), source captured. Pure parts; the browser part is ladder-capture.mjs --from-candidates.
// Guard: test/ladder-candidates.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {noEmail, noPhone, stripQuery} from './ladder-scrub.mjs';

export const CANDIDATES_DIR = path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA/replay-candidates');
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// -> [{day, name, dir, caseJson}] of one day (default: the newest). [] when the folder is not there.
export function readCandidates(root = CANDIDATES_DIR, {day = ''} = {}) {
  let days = [];
  try { days = fs.readdirSync(root).filter(name => fs.statSync(path.join(root, name)).isDirectory()).sort(); } catch { return []; }
  const chosen = day || days.at(-1);
  if (!chosen || !days.includes(chosen)) return [];
  const found = [];
  for (const name of fs.readdirSync(path.join(root, chosen)).sort()) {
    const dir = path.join(root, chosen, name);
    try { found.push({day: chosen, name, dir, caseJson: JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'))}); } catch { /* not a candidate folder */ }
  }
  return found;
}
// A run that did not reach the form (stopped at a posting, an account page, nothing recorded). A form with fields left is the fill mechanism's, not a page decision.
export const failedCandidate = caseJson => caseJson?.run?.reached !== 'form';
export const selectCandidates = (list, {only = ''} = {}) => (only ? list.filter(item => item.name === only || item.name.includes(only)) : list.filter(item => failedCandidate(item.caseJson)));

// The fixture file's content for a candidate: its sketch and numbered candidates as the extension's own builders made them (passed in), scrubbed.
export function candidateFixture({name, day, caseJson, sketch, candidates, lang = '', observed = null, fromRequest = false}) {
  const run = caseJson.run || {};
  const path_ = (run.path || []).map(step => step.kind).join(' > ');
  const url = stripQuery(caseJson.pages?.[0]?.url);
  return {
    schemaVersion: 1, id: `cand-${slug(name)}`, source: 'captured', ...(lang ? {lang} : {}),
    why: `auto-captured from the pool run of ${day}: ${caseJson.shape || name}`.replace(/\s*\(auto-saved[^)]*\)/, '').slice(0, 200),
    note: `smoke run ${day}: reached ${run.reached || 'nothing'}${path_ ? ` (${path_})` : ''}${observed?.kind ? `; the app answered ${observed.kind} by ${observed.by || '?'} at ${observed.confidence ?? '?'}` : ''}; the expectation is pending: say what the page really is`,
    capture: {from: `replay-candidates/${day}/${name}`, ...(fromRequest ? {request: 'ai-calls.json'} : {})},
    sketch: (({url: own, ...rest}) => ({url: own ?? url, ...noPhone(noEmail(rest))}))({url, ...sketch}), candidates: noPhone(noEmail(candidates || [])), expect: {outcome: 'pending'},
  };
}

// The one door every give-up goes through (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 1: "a dead-end detector must not become a new chain of
// conditions"): each dead end is named (a reason of endings.js STUCK_REASONS), its ending named, its evidence kept as fixed values, and today's "can't reach" report sent unchanged.
// In shadow: nothing here changes what happens; this is where the fallback (the one question at a dead end, phase 2) will be asked. The report is fill-flow.js stuck(), handed in once
// (useReporter) so no file calls it directly. Guard: worker/test/dead-end.test.js (a stuck() call anywhere else in the extension fails; the evidence keeps no page text).
import {STUCK_REASONS, endingOfStuck} from './endings.js';

let report = async () => {};
export const useReporter = fn => { report = fn; };

// Evidence: our own facts about the stop, never the page's words: numbers, booleans and short words of ours (a role, a kind, a signal, a reason of the code).
const WORD = /^[a-z0-9][a-z0-9 _.-]{0,39}$/i;
export function evidenceOf(raw = {}) {
  const kept = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (!/^[a-zA-Z]{1,24}$/.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) kept[key] = value;
    else if (typeof value === 'boolean') kept[key] = value;
    else if (typeof value === 'string' && WORD.test(value)) kept[key] = value;
  }
  return kept;
}

// stop: {job, host, why, tabId, page, needs, accountStep}: what stuck() is sent, as today. evidence: what led here (fixed values). decide: the log.
// -> the report's promise (a caller that did not wait for the report before does not wait now).
export function deadEnd(stop, evidence = {}, decide = () => {}) {
  const why = STUCK_REASONS.includes(stop.why) ? stop.why : 'no-form';
  decide('fill', `dead end: ${why}`, {host: stop.host || '', ending: endingOfStuck(why, stop.needs), ...evidenceOf(evidence)});
  return report(stop.job, stop.host, why, stop.tabId, stop.page, stop.needs || '', stop.accountStep || '');
}

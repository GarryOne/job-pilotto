// The one door every give-up goes through (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 1: "a dead-end detector must not become a new chain of
// conditions"): each dead end is named (a reason of endings.js STUCK_REASONS), its ending named, its evidence kept as fixed values, and today's "can't reach" report sent unchanged.
// In shadow: nothing here changes what happens; this is where the fallback (the one question at a dead end, phase 2) will be asked. The report is fill-flow.js stuck(), handed in once
// (useReporter) so no file calls it directly. Guard: worker/test/dead-end.test.js (a stuck() call anywhere else in the extension fails; the evidence keeps no page text).
import {STUCK_REASONS, UNRESOLVED, endingOfStuck} from './endings.js';
import {endSilence} from './silence.js';

let report = async () => {};
export const useReporter = fn => { report = fn; };

// Evidence: our own facts about the stop, never the page's words. The keys a caller may log are a fixed list (cc's review, 12 Oct 2026: so a page word can never reach the log
// through a new caller): text only under the keys that hold our own fixed words (a role, a kind, a signal, a step, a reason of the code), numbers and booleans under the rest.
// Any other key is dropped. A new kind of evidence is a new key here, with its test (worker/test/dead-end.test.js checks every caller's keys are listed).
export const EVIDENCE_KEYS = ['role', 'kind', 'signal', 'step', 'reason', 'rung', 'status', 'left', 'fields', 'frames', 'filled', 'botCheck', 'pressed', 'aiNamed', 'silentMs'];
const WORD_KEYS = new Set(['role', 'kind', 'signal', 'step', 'reason']);
const WORD = /^[a-z0-9][a-z0-9 _.-]{0,39}$/i;
export function evidenceOf(raw = {}) {
  const kept = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (!EVIDENCE_KEYS.includes(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) kept[key] = value;
    else if (typeof value === 'boolean') kept[key] = value;
    else if (typeof value === 'string' && WORD_KEYS.has(key) && WORD.test(value)) kept[key] = value;
  }
  return kept;
}

// stop: {job, host, why, tabId, page, needs, accountStep}: what stuck() is sent, as today. evidence: what led here (fixed values). decide: the log.
// -> the report's promise (a caller that did not wait for the report before does not wait now).
export function deadEnd(stop, evidence = {}, decide = () => {}) {
  const why = STUCK_REASONS.includes(stop.why) ? stop.why : 'other';   // an unknown stop claims nothing: not 'no form' (cc's review), the ladder's 'nothing usable to say'
  const named = !!String(stop.needs || '').trim();   // whether the person is told exactly what to do (never the words: desktop/e2e/lib/ending.mjs reads this line)
  decide('fill', `dead end: ${why}`, {host: stop.host || '', ending: endingOfStuck(why, stop.needs), named, ...evidenceOf(evidence)});
  endSilence(stop.tabId);   // the run said its last word for this application: no silence after it is a dead end (ladder/silence.js)
  return report(stop.job, stop.host, why, stop.tabId, stop.page, stop.needs || '', stop.accountStep || '');
}

// A dead end the run did not admit, SEEN in shadow (ladder/silence.js: no progress for T): logged at this door with {shadow: true} and never reported, so nothing changes for the
// person. A reader of the door's lines skips it by that field, never by its wording (cc, 13 Oct 2026: desktop/e2e/lib/ending.mjs). -> whether it was logged.
export const SEEN_REASONS = ['silent'];
export function seenDeadEnd(why, host, evidence = {}, decide = () => {}) {
  if (!SEEN_REASONS.includes(why)) return false;
  decide('fill', `dead end: ${why}`, {host: host || '', shadow: true, ending: UNRESOLVED, ...evidenceOf(evidence)});
  return true;
}

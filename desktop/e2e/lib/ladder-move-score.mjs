// Scores the next MOVE on the ladder fixtures that carry a confirmed expected move (expect.verb + expect.candidates, written by e2e/ladder-label-moves.mjs), both ways (spec
// 2026-10-12-one-next-move.md box 7): TODAY, the button rung 2 names (the fixture's stored answer through the real pageKind: its applyButton, matched to the numbered candidates by their own
// text) -> right / stop (no button: a dead end) / wrong; and the FALLBACK, the one question's digest answer (rung 3) -> right / unsure (right but below 0.8: it climbs, never acts) /
// wrong (it would not act) / wrong-confident (it would act on the wrong control). With the fallback, a page today stops on gets the fallback's move; elsewhere today's stands.
// Per source, never blended. Guard: test/ladder-move-score.test.js.
import {SOURCE_GROUP, SURE} from './ladder-score.mjs';

const textKey = text => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const ACTS = ['press', 'open'];   // both act on the one numbered control (the digest: press a button or link, open a link)
const sameVerb = (said, want) => said === want || (ACTS.includes(said) && ACTS.includes(want));

export function todayMove(fixture, applyButton) {
  if (!applyButton) return 'stop';
  const numbers = (fixture.candidates || []).filter(item => textKey(item.text) === textKey(applyButton)).map(item => item.n);
  return numbers.some(n => fixture.expect.candidates.includes(n)) ? 'right' : 'wrong';
}

export function fallbackMove(fixture, answer = {}) {
  const numbers = Array.isArray(answer.numbers) ? answer.numbers : [];
  const right = !answer.error && sameVerb(answer.verb, fixture.expect.verb) && numbers.length > 0 && numbers.every(n => fixture.expect.candidates.includes(n));
  const sure = !answer.error && (answer.confidence ?? 0) >= SURE;
  if (right) return sure ? 'right' : 'unsure';
  return sure && ACTS.includes(answer.verb) ? 'wrong-confident' : 'wrong';
}

// With the fallback on: today's move unless today stops, then the fallback's (only a sure right move unblocks; anything else stays a stop, the floors and the climb as today).
export const withFallback = (today, fallback) => (today !== 'stop' ? today : fallback === 'right' ? 'right' : fallback === 'wrong-confident' ? 'wrong' : 'stop');

// rows: [{id, source, today, fallback}] -> {bySource: {group: {fixtures, deadEnds, today: {right, stop, wrong}, fallback: {...}, both: {right, stop, wrong}}}, wrongConfident: [ids]}
export function summarizeMoves(rows) {
  const bySource = {};
  const bump = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
  for (const row of rows) {
    const group = SOURCE_GROUP[row.source] || row.source;
    const entry = bySource[group] ||= {fixtures: 0, deadEnds: 0, today: {}, fallback: {}, both: {}};
    entry.fixtures++;
    if (row.today === 'stop') entry.deadEnds++;
    bump(entry.today, row.today); bump(entry.fallback, row.fallback); bump(entry.both, withFallback(row.today, row.fallback));
  }
  return {bySource, wrongConfident: rows.filter(row => row.fallback === 'wrong-confident').map(row => row.id)};
}

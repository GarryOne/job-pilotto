// The AI's word on each saved answer (owner, 18 Oct 2026: "an automatic/intelligent way to put them on the queue"): clear, guess, vague or off_topic, a fixed
// answer of the move's judge call (lib/profile-move.js judge). Kept per line in settings.answerClarity as {[label\nvalue]: verdict}, so a line is judged once
// and judged again only when its value changes; "kept" = the person said "Keep as is" (never asked again for that value). A line with no verdict (the AI
// skipped it) is retried after a day. lib/details-review.js turns guess / vague / off_topic into queue items. Guarded by test/details-review-unclear.test.js.
import {parseLine} from './profile-sections.js';

export const CLARITY = ['clear', 'guess', 'vague', 'off_topic'];
export const UNCLEAR = {guess: 'Looks like a guess', vague: 'Too vague to use', off_topic: 'Does not answer the question'};
export const KEPT = 'kept';
const RETRY_MS = 24 * 3600 * 1000;
const same = text => String(text || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// A line's identity: its label and value without the kind mark and note (the same on the Profile, the answers page and in a section after a move).
export function sigOf(item) {
  const parsed = parseLine(item.label ? `${item.label}: ${item.value}` : `: ${item.value}`);
  return `${same(item.label)}\n${same(parsed.value || item.value)}`;
}
const map = storage => storage.settings().answerClarity || {};
export const verdictOf = (storage, item) => map(storage)[sigOf(item)] || '';

// The lines with no verdict yet (or a skipped one a day old).
export function unjudged(storage, items, now = new Date()) {
  const known = map(storage);
  return items.filter(item => {
    const verdict = known[sigOf(item)];
    return !verdict || (verdict.startsWith('?') && now - new Date(verdict.slice(1)) > RETRY_MS);
  });
}

// The judge's verdicts kept (judged: Map(id -> {clarity})); a "Keep as is" is never overwritten. Lines gone from the pages are forgotten (pass all of today's lines).
export function record(storage, items, judged, {now = new Date(), present = null} = {}) {
  const known = {...map(storage)};
  for (const item of items) {
    const sig = sigOf(item), clarity = judged.get(item.id)?.clarity;
    if (known[sig] === KEPT) continue;
    known[sig] = CLARITY.includes(clarity) ? clarity : `?${now.toISOString()}`;
  }
  if (present) { const live = new Set(present.map(sigOf)); for (const sig of Object.keys(known)) if (!live.has(sig)) delete known[sig]; }
  storage.saveSettings({answerClarity: known});
}

export function keepAsIs(storage, item) {
  storage.saveSettings({answerClarity: {...map(storage), [sigOf(item)]: KEPT}});
}

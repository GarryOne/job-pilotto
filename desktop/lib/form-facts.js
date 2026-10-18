// The facts of Your details that this Mac's forms asked for, with Your details' value (Profile → Application answers → "Profile facts used in forms";
// owner, 18 Oct 2026, decision 1: Your details is the one home of a shared fact, answers point to it, never copy it). "Asked" is the AI's verdict a fill
// already keeps per question (lib/question-verdicts.js: reuse "details" + the fact's label, counted when asked): no new AI call, no keyword list. A fact
// with no value is not listed here (the review queue asks for it: lib/missing-facts.js). Guarded by test/form-facts.test.js.
import {keyOf} from '../renderer/question-filter.js';

// verdicts: settings.questionVerdicts; facts: [{label, value}] of Your details (lib/base-facts.js factsOf). -> [{label, value, asked}], most asked first.
export function usedInForms(verdicts, facts) {
  const asked = new Map();
  for (const entry of Object.values(verdicts || {})) {
    if (entry?.reuse !== 'details' || !entry.fact || !(entry.asked > 0 || entry.blocked)) continue;
    asked.set(keyOf(entry.fact), (asked.get(keyOf(entry.fact)) || 0) + Math.max(1, Number(entry.asked) || 0));
  }
  const seen = new Set();
  return (facts || []).filter(fact => String(fact.value || '').trim() && asked.has(keyOf(fact.label)) && !seen.has(keyOf(fact.label)) && seen.add(keyOf(fact.label)))
    .map(fact => ({label: fact.label, value: String(fact.value).trim(), asked: asked.get(keyOf(fact.label))}))
    .sort((a, b) => b.asked - a.asked);
}

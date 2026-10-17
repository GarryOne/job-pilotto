// "Do both sides mean the same places?" for a Locations conflict (owner, 17 Oct 2026: "same meaning moves silently; only a true difference is asked,
// in plain place names"; cost approved: Haiku, ~$0.001 once per install). The crawl side's names (Zurich-area towns, spellings in four languages) and
// the Profile's words ("Zurich and surroundings") go to the AI with a fixed answer: which places only one side covers. The code checks every name
// it returns is one it was given; a mangled answer keeps the question (a weak answer is never kept as sure). The verdict is saved on the queue entry
// (checked), so it is asked once. Guarded by test/locations-same.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import {MODEL} from './locations-move.js';

const SCHEMA = {type: 'object', additionalProperties: false, required: ['onlyStrategy', 'onlyProfile'], properties: {
  onlyStrategy: {type: 'array', items: {type: 'string'}}, onlyProfile: {type: 'array', items: {type: 'string'}}}};
const INSTRUCTIONS = `Two lists answer the same question about where a job seeker wants to work. "Search" is the job search's list: place names, often nearby towns
and the same place spelt in several languages. "Profile" is what the person wrote, in any language. Decide which places only one list covers.
- A town inside a region or area the other list names is covered ("Winterthur" is covered by "Zurich and surroundings"; "Basel" by "Switzerland").
- The same place in another language or spelling is covered ("Genf" = "Geneva" = "Genève"; "Schweiz" = "Switzerland").
- A word that is not a place (e.g. "Remote", "Anywhere") is only covered by the same word on the other list.
- onlyStrategy: Search names not covered by Profile. onlyProfile: Profile entries not covered by Search. Copy each name exactly as given. Both empty = same meaning.`;

const bare = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const KIND_WORDS = {preferred: 'Preferred locations (cities they most want)', acceptable: 'Acceptable locations (fine, not first choice)', relocation: 'Places they would move to'};

// conflict: {kind, strategy: names, profile: names} -> {onlyStrategy, onlyProfile} (names from the inputs only), or null (no AI, a mangled answer).
export async function judgeSame(conflict, {client = null, apiKey = ''} = {}) {
  const ai = client || (apiKey ? anthropicApi(apiKey) : null);
  if (!ai) return null;
  const content = `Question: ${KIND_WORDS[conflict.kind] || conflict.kind}\nSearch: ${conflict.strategy.join('; ')}\nProfile: ${conflict.profile.join('; ')}`;
  const response = await ai.messages.create({model: MODEL, max_tokens: 1500, system: INSTRUCTIONS, messages: [{role: 'user', content}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}});
  let answer;
  try { answer = JSON.parse(response.content?.find(block => block.type === 'text')?.text || ''); } catch { return null; }
  const pick = (list, from) => {
    if (!Array.isArray(list)) return null;
    const known = new Map(from.map(name => [bare(name), name]));
    const names = list.map(name => known.get(bare(name)));
    return names.every(Boolean) ? [...new Set(names)] : null;   // a name it was not given: the answer is not trusted
  };
  const onlyStrategy = pick(answer?.onlyStrategy, conflict.strategy), onlyProfile = pick(answer?.onlyProfile, conflict.profile);
  return onlyStrategy && onlyProfile ? {onlyStrategy, onlyProfile} : null;
}

// The open conflicts -> {same: kinds that mean the same places, conflicts: the rest, each marked checked with what differs}.
// A "No relocation" side has no places to compare: always a true difference. A failed call leaves the entry unchecked (tried on the next open);
// a mangled answer marks it checked with no difference named (asked as it is, never resolved by a guess).
export async function settleSame(conflicts, ai) {
  const same = [], open = [];
  for (const conflict of conflicts) {
    if (conflict.checked || !conflict.profile?.length || !conflict.strategy?.length) { open.push({...conflict, checked: true}); continue; }
    let verdict;
    try { verdict = await judgeSame(conflict, ai); } catch { open.push(conflict); continue; }
    if (!verdict && !(ai?.client || ai?.apiKey)) { open.push(conflict); continue; }
    if (verdict && !verdict.onlyStrategy.length && !verdict.onlyProfile.length) same.push(conflict.kind);
    else open.push({...conflict, checked: true, ...(verdict || {})});
  }
  return {same, conflicts: open};
}

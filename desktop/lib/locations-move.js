// The one-time Locations move (owner, 17 Oct 2026): compares the crawl lists (search settings top_tier / country_wide / abroad) with the Profile's
// Countries / Preferred cities / Relocation rows and says per kind: same, one side unset, or conflict. Pure planning; nothing is written here.
// Matching values move by themselves; an unset side yields to the populated one; "No relocation" and "Anywhere" are values, not missing data; a conflict
// is queued with both values and NO preselected winner (profile / strategy / choose / separate). The AI only reads the Profile rows into a fixed answer
// (judgeProfile); it never writes a place. Guarded by test/locations-move.test.js. Where you live (Home base) is Your details' and is not compared here.
import {anthropicApi} from './ai/anthropic-api.js';

export const MODEL = 'claude-haiku-5-5';
export const KINDS = ['preferred', 'acceptable', 'relocation'];
export const CHOICES = ['profile', 'strategy', 'choose', 'separate'];
export const MODES = ['yes', 'no', 'unspecified'];
const SCHEMA = {type: 'object', additionalProperties: false, required: ['preferred', 'acceptable', 'relocation', 'destinations'], properties: {
  preferred: {type: 'array', items: {type: 'string'}}, acceptable: {type: 'array', items: {type: 'string'}},
  relocation: {type: 'string', enum: MODES}, destinations: {type: 'array', items: {type: 'string'}}}};
const INSTRUCTIONS = `You read the "where to work" rows of a job seeker's Profile, in any language, and sort them. Never invent a place; use only what the rows say.
- preferred: cities or regions they most want to work in (Preferred cities).
- acceptable: countries or regions where working is fine, not first choice. "Anywhere" is a value: list it as "Anywhere". Their home base is NOT a place to add.
- relocation: "yes" if they would move for a job, "no" if they say they would not, "unspecified" if the rows do not say.
- destinations: the places they would move to, when named.`;

const bare = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\\b|["^$]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = list => (Array.isArray(list) ? list : []).map(item => String(item).trim()).filter(Boolean);
const sameSet = (a, b) => a.length === b.length && new Set(a.map(bare)).size === new Set([...a, ...b].map(bare)).size;

// rows: [{label, value}] of the Profile's location rows -> {preferred, acceptable, relocation, destinations}, or null (no AI, no rows, a mangled answer).
export async function judgeProfile(rows, {client = null, apiKey = ''} = {}) {
  const ai = client || (apiKey ? anthropicApi(apiKey) : null);
  const lines = (rows || []).filter(row => row?.value).map(row => `${row.label}: ${row.value}`);
  if (!ai || !lines.length) return null;
  const response = await ai.messages.create({model: MODEL, max_tokens: 1000, system: INSTRUCTIONS, messages: [{role: 'user', content: lines.join('\n')}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}});
  let answer;
  try { answer = JSON.parse(response.content?.find(block => block.type === 'text')?.text || ''); } catch { return null; }
  const lists = ['preferred', 'acceptable', 'destinations'];
  if (!answer || !MODES.includes(answer.relocation) || lists.some(key => !Array.isArray(answer[key]))) return null;
  return {preferred: clean(answer.preferred), acceptable: clean(answer.acceptable), relocation: answer.relocation, destinations: clean(answer.destinations)};
}

// One kind's two sides -> {value} (decided) or {conflict: {strategy, profile}}. An empty list is "unset".
function compareList(strategy, profile) {
  if (!strategy.length) return {value: profile};
  if (!profile.length || sameSet(strategy, profile)) return {value: strategy};
  return {conflict: {strategy, profile}};
}

// search: the parsed search settings; profile: judgeProfile's answer. -> {resolved, conflicts: [{kind, strategy, profile}]} (a conflicted kind is absent from resolved).
export function classify(search, profile) {
  const places = search?.locations || {};
  const resolved = {}, conflicts = [];
  for (const [kind, key] of [['preferred', 'top_tier'], ['acceptable', 'country_wide']]) {
    const result = compareList(clean(places[key]), profile[kind]);
    if (result.conflict) conflicts.push({kind, ...result.conflict}); else resolved[kind] = result.value;
  }
  // Relocation: the crawl lists only know "places abroad" (none = never said, not "no"); the Profile can say No, and that is a value.
  const abroad = clean(places.abroad), mode = profile.relocation;
  if (!abroad.length) resolved.relocation = {mode, places: profile.destinations};
  else if (mode === 'no') conflicts.push({kind: 'relocation', strategy: abroad, profile: [], profileMode: 'no'});
  else if (mode === 'unspecified' || !profile.destinations.length || sameSet(abroad, profile.destinations)) resolved.relocation = {mode: 'yes', places: abroad};
  else conflicts.push({kind: 'relocation', strategy: abroad, profile: profile.destinations, profileMode: mode});
  return {resolved, conflicts};
}

// The person's pick for one conflict -> a new plan (the input is not changed). choose: {places: [...]} their own list.
export function resolveConflict(plan, kind, choice, {places = []} = {}) {
  const conflict = plan.conflicts.find(each => each.kind === kind);
  if (!conflict || !CHOICES.includes(choice)) throw new Error(`No open "${kind}" conflict or unknown choice "${choice}"`);
  const own = choice === 'strategy' ? conflict.strategy : choice === 'choose' ? clean(places) : conflict.profile;
  const value = kind !== 'relocation' ? own : {mode: own.length ? 'yes' : conflict.profileMode || 'no', places: own};
  const resolved = {...plan.resolved, [kind]: value};
  if (choice === 'separate') resolved.searchOverride = [...(plan.resolved.searchOverride || []), ...conflict.strategy];
  return {resolved, conflicts: plan.conflicts.filter(each => each !== conflict)};
}

// Writes the resolved kinds into a copy of the search settings; a kind not decided is left as it was, every other setting is kept.
export function applyLocations(search, resolved) {
  const locations = {...search?.locations};
  if (resolved.preferred) locations.top_tier = [...resolved.preferred];
  if (resolved.acceptable) locations.country_wide = [...resolved.acceptable];
  // relocation is a one-item list, like remote_jobs (the settings page's text sections)
  if (resolved.relocation) { locations.abroad = [...resolved.relocation.places]; locations.relocation = [resolved.relocation.mode]; }
  if (resolved.searchOverride?.length) locations.search_override = [...resolved.searchOverride];
  return {...search, locations};
}

// The public /changelog, per stable app version (spec docs/superpowers/specs/2026-10-16-daily-digest.md §6): the rules for what may be said there, a draft's validation, and adding an approved entry to public/changelog.json.
// Public means NOTHING internal: no tests, test accounts, outages, costs, CI, session names, and no Pro plan or price before Pro launches (owner, 16 Oct 2026: "say it quietly").
// The words are a safety FLOOR in front of the owner's yes, never what decides meaning (the AI writes, the owner approves). Guard: test/changelog.test.js also checks every published entry.
export const FORBIDDEN = /\$\s?\d|\b(?:usd|chf|eur)\b|\bpro\b|pricing|\bprice|\bcosts?\b|\bbilling\b|test[- ]account|outage|\bCI\b|\bsessions?\b|incident|red main|\bPRs?\b|pull request|\bworktree|\bflaky\b|\bAI limit|free ai|\bbudget|workers ai|\bkey\b|\btoken\b|\bsecret/i;
export const MODEL_PROMPT = `You write the public release notes of one version of Job Pilotto, a Mac/Windows app that finds jobs, drafts applications and fills application forms (the user always clicks Submit).
You get the commit subjects of the changes in this version. Keep ONLY changes a user of the app can see or feel (a screen, a button, a faster or more reliable step, a new thing it can do). Skip everything internal:
tests, CI, tooling, refactors, docs, costs, accounts, outages, prices or plans (never mention Pro, pricing, trials or credits). Rewrite each kept change as one plain sentence a non-engineer understands, in the user's terms.
Answer ONLY a JSON object: {"items":[{"lead":"Short lead, up to 6 words","text":"One plain sentence, up to 160 characters."}]} with 0 to 8 items; an empty list is a fine answer.`;

export const versionOf = tag => String(tag).replace(/^desktop-v/, '');
const short = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The AI's answer (string or object) -> {items, dropped: [text that broke a rule]} or {error}.
export function cleanItems(answer) {
  let data = answer;
  if (typeof answer === 'string') { const match = answer.match(/\{[\s\S]*\}/); try { data = JSON.parse(match ? match[0] : answer); } catch { return {error: 'not JSON'}; } }
  if (!Array.isArray(data?.items)) return {error: 'no items'};
  const items = [], dropped = [];
  for (const item of data.items.slice(0, 8)) {
    const lead = short(item?.lead, 60), text = short(item?.text, 180);
    if (!lead || !text) continue;
    if (FORBIDDEN.test(`${lead} ${text}`)) dropped.push(`${lead}: ${text}`); else items.push({lead, text});
  }
  return {items, dropped};
}

const SHAPE = /^\d+\.\d+\.\d+$/;
// One published entry: {version, date, items}. Returns the list of problems (empty = fine).
export function problems(entry) {
  const out = [];
  if (!SHAPE.test(entry?.version || '')) out.push('version');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.date || '')) out.push('date');
  if (!Array.isArray(entry?.items) || !entry.items.length) out.push('items');
  for (const item of entry?.items || []) if (!item?.lead || !item?.text || FORBIDDEN.test(`${item.lead} ${item.text}`)) out.push(`item: ${item?.lead}`);
  return out;
}

const order = version => version.split('.').map(Number);
// Adds (or replaces) an entry, newest version first. Throws when it breaks a rule: nothing unchecked reaches the public file.
export function addEntry(list, entry) {
  const bad = problems(entry);
  if (bad.length) throw new Error(`entry not publishable: ${bad.join(', ')}`);
  return [...list.filter(item => item.version !== entry.version), entry].sort((a, b) => { const x = order(a.version), y = order(b.version); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); });
}

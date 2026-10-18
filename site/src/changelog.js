// The public /changelog, one entry per released version, beta or stable (spec docs/superpowers/specs/2026-10-16-daily-digest.md §6, automatic since 18 Oct 2026): the rules for what may be said there and the checks of an entry.
// An entry is {version, date, channel, groups: [{kind, items: [{emoji?, lead, text}]}]}; the group titles and their emoji are code's (GROUPS), the AI only sorts changes into the three kinds.
// Public means NOTHING internal: no tests, test accounts, outages, costs, CI, session names, and no Pro plan or price before Pro launches (owner, 16 Oct 2026: "say it quietly").
// The words are a safety FLOOR in front of the owner's yes, never what decides meaning (the AI writes). CI checks an entry (tools/changelog-publish.mjs) and the site checks it again on PUT (src/changelog-store.js): nothing unchecked is shown. Guard: test/changelog.test.js.
export const FORBIDDEN = /\$\s?\d|\b(?:usd|chf|eur)\b|\bpro\b|pricing|\bprice|\bcosts?\b|\bbilling\b|test[- ]account|outage|\bCI\b|\bsessions?\b|incident|red main|\bPRs?\b|pull request|\bworktree|\bflaky\b|\bAI limit|free ai|\bbudget|workers ai|\bkey\b|\btoken\b|\bsecret/i;
// The three kinds, in page order; the AI answers only the kind, never the title.
export const GROUPS = {features: '✨ New features', improvements: '🚀 Improvements', fixes: '🐛 Bug fixes'};
export const CHANNELS = ['beta', 'stable', 'start'];   // 'start' = the 0.0.1 project-start entry, the only one not drafted by the AI
export const MODEL_PROMPT = `You write the public release notes of one version of Job Pilotto, a Mac/Windows app that finds jobs, drafts applications and fills application forms (the user always clicks Submit).
You get the commit subjects of the changes in this version. Keep ONLY changes a user of the app can see or feel (a screen, a button, a faster or more reliable step, a new thing it can do). Skip everything internal:
tests, CI, tooling, refactors, docs, costs, accounts, outages, prices or plans (never mention Pro, pricing, trials or credits). Merge commits about the same thing into one item. Rewrite each kept change as one friendly, plain sentence a non-engineer understands, in the user's terms.
Sort each item into one kind: "features" (a new thing the app can do), "improvements" (something existing got better, faster or clearer), "fixes" (something that was broken now works).
Give each item one fitting emoji. Answer ONLY a JSON object: {"groups":[{"kind":"features","items":[{"emoji":"🔎","lead":"Short lead, up to 6 words","text":"One plain sentence, up to 160 characters."}]}]}
with at most 6 items per kind and only kinds that have items; an empty "groups" list is a fine answer.`;

// A big version is read in parts (tools/changelog-publish.mjs); this joins the parts' notes into the one list the page shows.
export const MERGE_PROMPT = `You get the release notes of ONE version of Job Pilotto, written in several parts, one line each as "- [kind] lead: text". Join them into one list: merge lines about the same thing into one, keep the most useful for a user of the app, at most 6 items per kind.
Keep each item's wording plain and short; do not add anything that is not in the parts. Answer ONLY a JSON object: {"groups":[{"kind":"features","items":[{"emoji":"🔎","lead":"Short lead, up to 6 words","text":"One plain sentence, up to 160 characters."}]}]}
with the kinds "features", "improvements", "fixes" and only kinds that have items.`;

export const versionOf = tag => String(tag).replace(/^desktop-v/, '');
const short = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const EMOJI = /^\p{Extended_Pictographic}️?$/u;

// The AI's answer (string or object) -> {groups, dropped: [text that broke a rule]} or {error}. An unknown kind is dropped, a bad emoji is left out, a kind with no clean item disappears.
export function cleanGroups(answer) {
  let data = answer;
  if (typeof answer === 'string') { const match = answer.match(/\{[\s\S]*\}/); try { data = JSON.parse(match ? match[0] : answer); } catch { return {error: 'not JSON'}; } }
  if (!Array.isArray(data?.groups)) return {error: 'no groups'};
  const groups = [], dropped = [];
  for (const kind of Object.keys(GROUPS)) {
    const items = [];
    for (const group of data.groups.filter(entry => entry?.kind === kind)) for (const item of (Array.isArray(group.items) ? group.items : []).slice(0, 6)) {
      const lead = short(item?.lead, 60), text = short(item?.text, 180), emoji = EMOJI.test(short(item?.emoji, 8)) ? short(item.emoji, 8) : '';
      if (!lead || !text) continue;
      if (FORBIDDEN.test(`${lead} ${text}`)) dropped.push(`${lead}: ${text}`); else items.push(emoji ? {emoji, lead, text} : {lead, text});
    }
    if (items.length) groups.push({kind, items: items.slice(0, 6)});
  }
  return {groups, dropped};
}

const SHAPE = /^\d+\.\d+\.\d+$/;
// One published entry. Returns the list of problems (empty = fine).
export function problems(entry) {
  const out = [];
  if (!SHAPE.test(entry?.version || '')) out.push('version');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.date || '')) out.push('date');
  if (!CHANNELS.includes(entry?.channel)) out.push('channel');
  if (!Array.isArray(entry?.groups) || !entry.groups.length) out.push('groups');
  for (const group of Array.isArray(entry?.groups) ? entry.groups : []) {
    if (!GROUPS[group?.kind]) out.push(`kind: ${group?.kind}`);
    if (!Array.isArray(group?.items) || !group.items.length) out.push(`items: ${group?.kind}`);
    for (const item of Array.isArray(group?.items) ? group.items : []) {
      if (!item?.lead || !item?.text || FORBIDDEN.test(`${item.lead} ${item.text}`) || (item.emoji && !EMOJI.test(item.emoji))) out.push(`item: ${item?.lead}`);
    }
  }
  return out;
}

const order = version => version.split('.').map(Number);
// Newest version first.
export const newestFirst = list => [...list].sort((a, b) => { const x = order(a.version), y = order(b.version); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); });

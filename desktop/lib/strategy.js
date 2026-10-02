// Strategy builder: CV (PDF) + an optional note from the user -> proposed goals, a draft Profile, standard answers
// and search settings, in one Claude call. Nothing is saved until the user reviews (and corrects) the draft.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import * as notion from './notion.js';
import {REPO} from './pipeline.js';

export const MODEL = 'claude-sonnet-5';
const PRICE = {input: 2, output: 10}; // USD per million tokens, claude-sonnet-5

// Contact details typed into application forms (the Chrome extension's fields), read from the CV.
export const CONTACT_FIELDS = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'location', 'linkedin', 'github', 'website'];
const list = {type: 'array', items: {type: 'string'}};
const object = (properties) => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
// The goals the review shows as tiles (roles and places are the search lists): proposed from the CV, corrected by the user.
export const GOALS = {seniority: 'Target level', work_mode: 'Work mode', minimum_salary: 'Minimum salary', languages: 'Languages you work in'};
export const DRAFT_SCHEMA = object({
  summary: {type: 'string'},
  goals: object(Object.fromEntries(Object.keys(GOALS).map(key => [key, {type: 'string'}]))),
  profile_markdown: {type: 'string'},
  answers_markdown: {type: 'string'},
  open_questions: list,
  search: object({
    role_keywords: list, title_exclude_keywords: list, board_discovery_keywords: list,
    jobs_board_search_queries: list, quality_stack_keywords: list,
    locations: object({top_tier: list, country_wide: list, abroad: list}),
    remote_excluded_regions: list,
    google_jobs: object({
      queries: list, country: {type: 'string'},
      locations: {type: 'array', items: object({location: {type: 'string'}, language: {type: 'string'}})},
    }),
  }),
  preferences: object({disqualifying_languages: list, excluded_companies: list}),
  contact: object(Object.fromEntries(CONTACT_FIELDS.map(field => [field, {type: 'string'}]))),
});

// Remote jobs open only to other parts of the world are not for this user (a friend in Romania was shown "Remote (United States | Canada)"
// roles, 2 Oct 2026, because the drafted list was short). Whatever the AI proposes, these regions are skipped unless the user's own places
// are in them. Regex fragments, as in config/search.json.
export const DEFAULT_REMOTE_EXCLUDED = ['\\busa?\\b', '\\bunited\\ states\\b', 'u\\.s\\.', '\\bcanada\\b', '\\bnorth\\ america\\b', '\\blatam\\b',
  '\\blatin\\ america\\b', '\\bapac\\b', '\\basia\\b', '\\bindia\\b', '\\baustralia\\b', '\\bbrazil\\b', '\\bmexico\\b', '\\bamericas\\b'];
export function withRemoteDefaults(search = {}) {
  const places = Object.values(search.locations || {}).flat().map(String).join(' | ');
  const mine = fragment => { try { return new RegExp(fragment, 'i').test(places); } catch { return false; } };
  const have = new Set((search.remote_excluded_regions || []).map(String));
  const added = DEFAULT_REMOTE_EXCLUDED.filter(fragment => !have.has(fragment) && !mine(fragment));
  return added.length ? {...search, remote_excluded_regions: [...(search.remote_excluded_regions || []), ...added]} : search;
}

export function userNote(answers = {}) {
  const note = String(answers.anything_else || '').trim();
  return note ? `<note_from_user>\n${note}\n</note_from_user>\n\n` : '<note_from_user>(none: propose everything from the CV)</note_from_user>\n\n';
}

// The note the user wrote before building ("What should the AI know about what you want?"), kept at the end of the
// drafted Profile, so Notion has it (the source of truth; settings.questionnaire is only the field's unsent draft).
// A section already there (a regenerated draft) is replaced; no note, no section.
export const NOTE_HEADING = '# What I told the AI';
export function withNote(profile, answers = {}) {
  const note = String(answers.anything_else || '').trim();
  const lines = String(profile || '').split('\n');
  const start = lines.findIndex(line => line.trim() === NOTE_HEADING);
  let kept = lines;
  if (start >= 0) {
    const end = lines.findIndex((line, i) => i > start && /^#\s/.test(line));
    kept = [...lines.slice(0, start), ...(end >= 0 ? lines.slice(end) : [])];
  }
  const body = kept.join('\n').trimEnd();
  if (!note) return body ? `${body}\n` : '';
  const text = note.split('\n').map(line => line.trimEnd()).join('\n');
  return `${body}\n\n${NOTE_HEADING}\n\n${text}\n`;
}

function template() {
  const text = fs.readFileSync(path.join(REPO, 'docs', 'notion-profile-template.md'), 'utf8');
  return text.slice(text.indexOf('## 👤'));
}

const INSTRUCTIONS = `You set up Job Pilotto, a job-search assistant, for a new user from their CV and, if they wrote one, a short note. They did not fill in a questionnaire: you propose what they are looking for from the CV, and they correct it in a review before anything is saved.

First decide their goals from the CV (the note wins where it says something):
- Target roles: their current role family at their current level, plus close titles the CV clearly supports.
- Level: the seniority their experience shows (e.g. "Senior", "Staff / Principal").
- Places: where they live now (from the CV), then the rest of that country, then remote in their region; abroad only if the CV shows moves or the note asks.
- Work mode: "On-site, hybrid or remote" unless the CV or note says otherwise.
- Minimum salary: a realistic floor for that level and market, in the local currency, a year, ending with "(estimate)". Never present it as their own figure.
- Languages they can work in, with level, from the CV. Jobs requiring any other language well are disqualifying.
- Companies to skip: their current employer.

Write:
0. goals: those proposals in a few words each (seniority, work_mode, minimum_salary, languages). The same values go into the Profile below.
1. profile_markdown: the user's Profile, following the "Profile — CV and Preferences" template's headings. Facts only from the CV and the note, plus the goals above (keep the template's row names "Work mode", "Languages I can work in", "Minimum seniority" and the Compensation line "Minimum acceptable:", so the user's corrections land in the right place). Mark anything else unknown (work permit, notice period…) with ❓ (the app treats ❓ as "ask the user", never as a fact).
2. answers_markdown: their standard application answers, following the "Application Answers" template, same rule for ❓. Include a short "Cover letter style" section inferred from how the CV is written.
3. search: what the job crawler looks for. Values in role_keywords, title_exclude_keywords, board_discovery_keywords, quality_stack_keywords, locations and remote_excluded_regions are case-insensitive regex fragments in the style of the example (e.g. "z[uü]rich", "\\\\bsre\\\\b", "platform engineer"). jobs_board_search_queries and google_jobs.queries are plain search phrases (3 to 6). locations.top_tier holds the cities they want most, country_wide the rest of that country, abroad other cities they'd move to. remote_excluded_regions lists regions whose "remote" jobs exclude them. google_jobs.locations uses SerpApi canonical names ("Zurich,Zurich,Switzerland") with the place's own language code ("de" for Zurich, "fr" for Geneva, "en" for London).
4. preferences.disqualifying_languages: languages a job may require that the user doesn't speak well enough to work in. excluded_companies: companies to skip (their current employer, and any the note names).
5. summary: at most 2 short sentences to the user, addressing them as "you" (never by name, never "I've set up"), saying what you'll search for and what they should check. open_questions: what they should still answer, short.
6. contact: the user's contact details exactly as written in the CV (city for location; full URLs for LinkedIn, GitHub and website). Empty string for anything the CV doesn't show; never guess.`;

// The draft streams in, in schema order; progress is how much of it has arrived and which part is being
// written. The expected length starts at a typical draft and then follows this user's last one.
const PARTS = [['"summary"', 'Writing the summary'], ['"goals"', 'Proposing your goals'], ['"profile_markdown"', 'Writing your Profile'],
  ['"answers_markdown"', 'Writing your standard answers'], ['"open_questions"', 'Listing what to check'],
  ['"search"', 'Choosing search settings'], ['"preferences"', 'Setting filters']];

// The bar: 0-10% while Claude reads the CV (main.js ticks it by time), then each part of the answer has its
// share, in the fixed order Claude writes them; inside a part, its length so far against its usual length
// (learned from the user's last draft: settings.draftSections).
export const SECTIONS = [['summary', 3, 400], ['goals', 2, 250], ['profile_markdown', 40, 15000], ['answers_markdown', 20, 9000],
  ['open_questions', 3, 500], ['search', 17, 3500], ['preferences', 3, 300], ['contact', 2, 300]];
export const READING = 10;
export function sectionLengths(text) {
  const at = SECTIONS.map(([key]) => text.indexOf(`"${key}"`));
  return Object.fromEntries(SECTIONS.map(([key], i) => [key, at[i] < 0 ? 0 : (at.slice(i + 1).find(n => n > at[i]) ?? text.length) - at[i]]));
}
export function progress(text, typical = {}) {
  let part = 'Reading your CV';
  for (const [key, label] of PARTS) if (text.includes(key)) part = label;
  const lengths = sectionLengths(text);
  let percent = text.length ? READING : 0;
  const started = SECTIONS.filter(([key]) => lengths[key]);
  started.forEach(([key, share, usual], i) => {
    // A finished part (the next one has started) counts in full; only the one being written is estimated.
    percent += i < started.length - 1 ? share : share * Math.min(0.95, lengths[key] / (typical[key] || usual));
  });
  return {part, percent: Math.min(99, Math.round(percent)), chars: text.length, notes: notes(text)};
}

// What Claude has written so far, as short lines for the screen ("Profile: Hard constraints", "Roles: site
// reliability, platform engineer"), read from the JSON it streams. Only finished pieces are shown.
const unescape = s => s.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\u00e9/g, 'é').trim();
export function notes(text) {
  const out = [];
  const region = (key, next) => {
    const start = text.indexOf(`"${key}"`);
    if (start < 0) return null;
    const end = next.map(k => text.indexOf(`"${k}"`, start + 1)).filter(i => i > 0).sort((a, b) => a - b)[0];
    return {body: text.slice(start, end ?? text.length), done: end !== undefined};
  };
  const summary = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (summary) out.push(`Summary: ${unescape(summary[1]).slice(0, 140)}`);
  const goals = text.match(/"goals"\s*:\s*\{((?:[^}"]|"(?:[^"\\]|\\.)*")*)\}/);
  if (goals) {
    const values = Object.keys(GOALS).map(key => (goals[1].match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)) || [])[1]).filter(Boolean);
    out.push(`Proposed goals: ${values.map(unescape).join(' · ')}`);
  }
  for (const [key, label, next] of [['profile_markdown', 'Profile', ['answers_markdown']], ['answers_markdown', 'Standard answers', ['open_questions', 'search']]]) {
    const piece = region(key, next);
    if (!piece) continue;
    const headings = [...piece.body.matchAll(/(?:\\n|: ?")#{1,3} ([^\\"]{2,70})(?=\\n)/g)].map(m => m[1].trim());
    for (const heading of headings) out.push(`${label}: ${heading}`);
    if (piece.done) out.push(`${label} written`);
  }
  const questions = text.match(/"open_questions"\s*:\s*\[((?:[^\]"]|"(?:[^"\\]|\\.)*")*)\]/);
  if (questions) out.push(`Things for you to check: ${(questions[1].match(/"(?:[^"\\]|\\.)*"/g) || []).length}`);
  const list = key => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*\\[((?:[^\\]"]|"(?:[^"\\\\]|\\\\.)*")*)\\]`));
    return m ? (m[1].match(/"((?:[^"\\]|\\.)*)"/g) || []).map(s => s.slice(1, -1).replace(/\\\\b/g, '').replace(/\\\\/g, '').replace(/\[[a-z]([^\]])\]/g, '$1')) : null;
  };
  const roles = list('role_keywords');
  if (roles) out.push(`Roles to look for: ${roles.slice(0, 6).join(', ')}${roles.length > 6 ? '…' : ''}`);
  const places = list('top_tier');
  if (places) out.push(`Best places: ${places.slice(0, 5).join(', ')}${places.length > 5 ? '…' : ''}`);
  const languages = list('disqualifying_languages');
  if (languages) out.push(languages.length ? `Jobs requiring ${languages.join(', ')} will be hidden` : 'No language filter');
  if (/"contact"\s*:\s*\{[^}]*"email"\s*:\s*"[^"]+"/.test(text)) out.push('Contact details found in your CV');
  return out;
}

// answers: {anything_else} from the wizard's strategy step (optional; older drafts had a whole questionnaire).
export async function draft(storage, answers, apiKey, client = null, onProgress = null) {
  const cv = fs.readFileSync(storage.path('cv.pdf'));
  const example = fs.readFileSync(path.join(REPO, 'config', 'search.json'), 'utf8');
  const anthropic = client || new Anthropic({apiKey});
  const request = {
    model: MODEL,
    max_tokens: 16000,
    system: INSTRUCTIONS,
    messages: [{role: 'user', content: [
      {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: cv.toString('base64')}},
      {type: 'text', text: `${userNote(answers)}<templates>\n${template()}\n</templates>\n\n<example_search_settings>\n${example}\n</example_search_settings>`},
    ]}],
    output_config: {format: {type: 'json_schema', schema: DRAFT_SCHEMA}},
  };
  let response;
  const typical = storage.settings().draftSections || {};
  if (onProgress && anthropic.messages.stream) {
    const stream = anthropic.messages.stream(request);
    stream.on('text', (_, snapshot) => onProgress(progress(snapshot, typical)));
    response = await stream.finalMessage();
  } else {
    response = await anthropic.messages.create(request);
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read this CV');
  if (response.stop_reason === 'max_tokens') throw new Error('The draft was cut off; try again');
  const text = response.content.find(block => block.type === 'text').text;
  const result = JSON.parse(text);
  if (typeof result.profile_markdown === 'string') result.profile_markdown = withNote(result.profile_markdown, answers);
  if (result.search) result.search = withRemoteDefaults(result.search);
  storage.saveSettings({draftSections: sectionLengths(text)});  // the next draft's bar follows this one's parts
  const usage = response.usage || {};
  result.usd = usage.billing === 'subscription' ? 0 : Math.round(((usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output) / 1e4) / 100;
  return result;
}

// Accepting a draft writes the Profile, answers and the pipeline's settings into the user's folder.
// The Profile and standard answers: the Notion pages (the only copy; Notion is required).
export async function profileTexts(storage) {
  const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
  if (!token || !ids.NOTION_PROFILE_PAGE_ID) throw new Error('Connect Notion first: your Profile and standard answers live there.');
  const [profile, answers] = await Promise.all([notion.pageText(token, ids.NOTION_PROFILE_PAGE_ID),
    ids.NOTION_ANSWERS_PAGE_ID ? notion.pageText(token, ids.NOTION_ANSWERS_PAGE_ID) : '']);  // kept pages (lib/notion.js)
  return {profile, answers};
}
// Copies an older version kept on the Mac go once Notion has them (lib/migrate.js).
export function dropLocalCopies(storage) {
  for (const name of ['profile.md', 'answers.md']) fs.rmSync(storage.path(name), {force: true});
}

// ⚙️ Search settings: a readable Notion page next to the Profile (src/notion/search_settings.py parses it before
// every crawl; config/search.json and preferences.json are only its cache). Created when missing, and
// rewritten from the cached settings (e.g. after a strategy is rebuilt from the CV).
export async function publishSearchSettings(storage, {run, ensurePage, writePage}) {
  const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
  if (!token || !ids.NOTION_PROFILE_PAGE_ID) return null;
  let page = ids.NOTION_SEARCH_SETTINGS_PAGE;
  if (!page) {
    page = await ensurePage(token, ids.NOTION_PROFILE_PAGE_ID, SEARCH_SETTINGS_TITLE, '');
    storage.saveSettings({notionIds: {...storage.settings().notionIds, NOTION_SEARCH_SETTINGS_PAGE: page}});
  }
  const {code, stdout} = await run(storage, ['src.notion.search_settings', 'render']);
  if (code !== 0 || !stdout.trim()) throw new Error('Could not render the search settings');
  await writePage(token, page, stdout);
  return page;
}
export const SEARCH_SETTINGS_TITLE = '⚙️ Search settings';

// The daily applications target (Focus, reminders) is a line of ⚙️ Search settings. The page is read first
// (edits made in Notion are kept), then written with the new value; if Notion refuses, the cache is put back.
export const DEFAULT_TARGET = 5;  // fewer, better applications: a handful of good-fit ones a day
export const clampTarget = value => Math.max(1, Math.min(200, Math.round(Number(value)) || DEFAULT_TARGET));
export function dailyTarget(storage) {
  try { return clampTarget(JSON.parse(storage.readText('config/preferences.json') || '{}').daily_applications_target); }
  catch { return DEFAULT_TARGET; }
}
export async function setDailyTarget(storage, value, {run, ensurePage, writePage}) {
  const target = clampTarget(value);
  await run(storage, ['src.notion.search_settings', 'sync']);
  const before = storage.readText('config/preferences.json') || '{}';
  storage.writeText('config/preferences.json', JSON.stringify({...JSON.parse(before), daily_applications_target: target}, null, 2) + '\n');
  try {
    await publishSearchSettings(storage, {run, ensurePage, writePage});
  } catch (error) {
    storage.writeText('config/preferences.json', before);
    throw error;
  }
  return target;
}

// Role terms the user chose to add after the app said the search was narrow (src/coverage.py). Like the daily target they live in
// ⚙️ Search settings: the page is read first (edits made in Notion are kept), the terms are added, the page is written again; if
// Notion refuses, the cache is put back so the two never disagree.
export const ROLE_TERM = /^[a-z][a-z0-9+#.\- ]{1,38}[a-z0-9+#]$/i;
const escapeRegex = term => term.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
export async function addRoles(storage, terms, {run, ensurePage, writePage}) {
  const wanted = [...new Set((Array.isArray(terms) ? terms : []).map(term => String(term).trim().toLowerCase()).filter(term => ROLE_TERM.test(term)))].slice(0, 10);
  if (!wanted.length) return {added: []};
  await run(storage, ['src.notion.search_settings', 'sync']);
  const before = storage.readText('config/search.json') || '{}';
  const search = JSON.parse(before);
  const have = new Set((search.role_keywords || []).map(entry => String(entry).toLowerCase()));
  const added = wanted.filter(term => !have.has(escapeRegex(term)));
  if (!added.length) return {added: []};
  storage.writeText('config/search.json', JSON.stringify({...search, role_keywords: [...(search.role_keywords || []), ...added.map(escapeRegex)]}, null, 2) + '\n');
  try {
    await publishSearchSettings(storage, {run, ensurePage, writePage});
  } catch (error) {
    storage.writeText('config/search.json', before);
    throw error;
  }
  return {added};
}

export function save(storage, accepted) {
  // The Profile, standard answers and contact details go to Notion (main.js saveStrategy); here only the
  // search settings' cache is written (published to ⚙️ Search settings right after).
  // A rebuild review may accept only some parts: a part left out (search or preferences) is not touched.
  if (accepted.search) {
    const current = JSON.parse(storage.readText('config/search.json') || '{}');
    const google = {...(current.google_jobs || {}), ...accepted.search.google_jobs,
      searches_per_run: current.google_jobs?.searches_per_run ?? 1, min_searches_left: current.google_jobs?.min_searches_left ?? 20};
    storage.writeText('config/search.json', JSON.stringify({...current, ...accepted.search, google_jobs: google}, null, 2) + '\n');
  }
  if (accepted.preferences) {
    const preferences = JSON.parse(storage.readText('config/preferences.json') || '{}');
    storage.writeText('config/preferences.json', JSON.stringify({...preferences, ...accepted.preferences}, null, 2) + '\n');
  }
}

// ---------- Rebuild from CV: what a new draft changes, grouped by what each change triggers ----------
// Search criteria and filters change what the crawl keeps and hides; the Profile's scoring part changes every fit
// score (re-scored over the next searches, AI cost); standard answers only change future kits and forms. Locations
// and remote rules live in both the search settings (crawl) and the Profile (score): a change to them links the two
// groups, so they're applied together and can't disagree.
export const SCORE_USD = 0.015;       // one Sonnet 5 fit score, measured on the owner's runs (about 1.2 to 1.8 cents)
export const SCORES_PER_SEARCH = 60;  // the app's --score-max
const FORM_ONLY = /contact|\blinks?\b|application form answers|📎/i;
export const wordsOf = fragment => String(fragment).replace(/\\b/g, '').replace(/\[[^\]]*?([^\]])\]/g, '$1').replace(/[.?*+()^$|\\]/g, '').trim();
function sections(markdown, skipFormOnly = false) {
  const found = new Map();
  let name = '', skipping = false;
  for (const line of String(markdown || '').split('\n')) {
    const heading = line.match(/^\s*#+\s+(.*)/);
    if (heading) { name = heading[1].trim(); skipping = skipFormOnly && FORM_ONLY.test(name); if (!skipping) found.set(name, []); continue; }
    if (!skipping && line.trim()) (found.get(name) || found.set(name, []).get(name)).push(line.trim());
  }
  return found;
}
function sectionChanges(before, after, skipFormOnly) {
  const old = sections(before, skipFormOnly), next = sections(after, skipFormOnly);
  const changes = [];
  for (const [name, lines] of next) {
    if (!old.has(name)) changes.push(`+ ${name || 'Intro'} (new section)`);
    else if (old.get(name).join('\n') !== lines.join('\n')) changes.push(`~ ${name || 'Intro'}`);
  }
  for (const name of old.keys()) if (!next.has(name)) changes.push(`− ${name || 'Intro'} (removed)`);
  return changes;
}
function listChanges(label, before = [], after = []) {
  const old = new Set(before.map(wordsOf)), next = new Set(after.map(wordsOf));
  const added = [...next].filter(item => item && !old.has(item)), removed = [...old].filter(item => item && !next.has(item));
  return added.length || removed.length ? [`${label}: ${[...added.map(item => `+${item}`), ...removed.map(item => `−${item}`)].join(', ')}`] : [];
}
export function rebuildGroups({search = {}, preferences = {}, profile = '', answers = ''}, draft, {scored = 0, kits = 0} = {}) {
  const next = draft.search || {}, places = search.locations || {}, nextPlaces = next.locations || {};
  const where = [...listChanges('Top cities', places.top_tier, nextPlaces.top_tier), ...listChanges('Country', places.country_wide, nextPlaces.country_wide),
    ...listChanges('Abroad', places.abroad, nextPlaces.abroad), ...listChanges('Remote excluded for', search.remote_excluded_regions, next.remote_excluded_regions)];
  const searchChanges = [...listChanges('Roles', search.role_keywords, next.role_keywords),
    ...listChanges('Job board searches', search.jobs_board_search_queries, next.jobs_board_search_queries), ...where,
    ...listChanges('Excluded titles', search.title_exclude_keywords, next.title_exclude_keywords),
    ...listChanges('Tech stack', search.quality_stack_keywords, next.quality_stack_keywords)];
  const prefs = draft.preferences || {};
  const filterChanges = [...listChanges('Languages you don\'t work in', preferences.disqualifying_languages, prefs.disqualifying_languages),
    ...listChanges('Excluded companies', preferences.excluded_companies, prefs.excluded_companies)];
  const profileChanges = sectionChanges(profile, draft.profile_markdown, true);
  const answerChanges = sectionChanges(answers, draft.answers_markdown, false);
  const searches = Math.max(1, Math.ceil(scored / SCORES_PER_SEARCH));
  const linked = where.length > 0 && profileChanges.length > 0;
  return [
    {id: 'search', title: 'Search criteria', changes: searchChanges, linked: linked ? 'profile' : null,
      impact: 'The next search crawls and ranks with them. Jobs found before stay until they are unseen for 7 days.', cost: 'No AI cost'},
    {id: 'filters', title: 'Filters', changes: filterChanges, impact: 'Matching jobs are hidden at once.', cost: 'No AI cost'},
    {id: 'profile', title: 'Profile (what the fit score reads)', changes: profileChanges, linked: linked ? 'search' : null,
      impact: `Re-scores ${scored} job${scored === 1 ? '' : 's'} over the next ${searches} search${searches === 1 ? '' : 'es'}` +
        (kits ? `; ${kits} unsent kit${kits === 1 ? '' : 's'} were drafted with the old Profile (redraft the ones you still want)` : '') + '.',
      cost: scored ? `≈ $${(scored * SCORE_USD).toFixed(2)}` : 'No AI cost'},
    {id: 'answers', title: 'Standard answers', changes: answerChanges, impact: 'Used by the next kits and form fills. Nothing is re-scored.', cost: 'No AI cost'},
  ].filter(group => group.changes.length);
}

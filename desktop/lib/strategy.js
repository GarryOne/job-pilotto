// Strategy builder: CV (PDF) + an optional note from the user -> proposed goals, a draft Profile, standard answers
// and search settings, in one Claude call. Nothing is saved until the user reviews (and corrects) the draft.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import * as notion from './notion.js';
import * as notionGate from './notion-gate.js';
import {REPO} from './pipeline.js';

export const MODEL = process.env.JOB_PILOTTO_MODEL_OVERRIDE || 'claude-sonnet-5-5';   // the override is for the end-to-end journey (desktop/e2e): every step on Haiku
const PRICE = {input: 2, output: 10}; // USD per million tokens, claude-sonnet-5-5

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
    role_keywords: list, level: list, title_exclude_keywords: list, board_discovery_keywords: list,
    jobs_board_search_queries: list, quality_stack_keywords: list,
    locations: object({top_tier: list, country_wide: list, abroad: list}),
    remote_excluded_regions: list,
    google_jobs: object({
      queries: list, country: {type: 'string'},
      locations: {type: 'array', items: object({location: {type: 'string'}, language: {type: 'string'}})},
    }),
  }),
  preferences: object({disqualifying_languages: list, excluded_companies: list, work_rights: list}),
  contact: object(Object.fromEntries(CONTACT_FIELDS.map(field => [field, {type: 'string'}]))),
});

// Remote jobs open only to other parts of the world are not for this user (a friend in Romania was shown "Remote (United States | Canada)"
// roles, 2 Oct 2026, because the drafted list was short). Whatever the AI proposes, these regions are skipped unless the user's own places
// are in them. Regex fragments, as in config/search.json.
export const DEFAULT_REMOTE_EXCLUDED = ['\\busa?\\b', '\\bunited\\ states\\b', 'u\\.s\\.', '\\bcanada\\b', '\\bnorth\\ america\\b', '\\blatam\\b',
  '\\blatin\\ america\\b', '\\bapac\\b', '\\basia\\b', '\\bindia\\b', '\\baustralia\\b', '\\bbrazil\\b', '\\bmexico\\b', '\\bamericas\\b'];
export function withRemoteDefaults(search = {}) {
  const places = Object.values(search.locations || {}).flat().map(String).join(' | ');
  // A region is the user's own when their places are in it: "latam" for someone in Brazil, "north america" for someone in the US.
  const IN_REGION = {latam: /brazil|mexico|argentina|chile|colombia|peru|uruguay/, 'latin america': /brazil|mexico|argentina|chile|colombia|peru|uruguay/,
    'north america': /united states|usa|\bus\b|canada|mexico/, americas: /united states|usa|\bus\b|canada|mexico|brazil|argentina|chile|colombia/,
    apac: /australia|india|japan|singapore|new zealand/, asia: /india|japan|singapore/,
    'usa?': /united states|\busa?\b/, 'u.s.': /united states|\busa?\b/, 'united states': /united states|\busa?\b/};
  const mine = fragment => {
    const words = fragment.replace(/\\b|\\/g, '').toLowerCase();
    if (IN_REGION[words]?.test(places.toLowerCase())) return true;
    try { return new RegExp(fragment, 'i').test(places); } catch { return false; }
  };
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
3. search: what the job crawler looks for. Values in role_keywords, title_exclude_keywords, board_discovery_keywords, quality_stack_keywords, locations and remote_excluded_regions are case-insensitive regex fragments in the style of the example (e.g. "z[uü]rich", "\\\\bsre\\\\b", "platform engineer", "registered nurse", "\\\\bhr\\\\b"). level is one word for the seniority they are looking for, "junior", "mid", "senior" or "lead" (from the Level goal above), or an empty list when the CV does not make it clear: it skips postings whose title plainly names another level, so leave it empty rather than guess. locations.top_tier and country_wide may use a region word instead of a list of towns when it fits ("Switzerland", "Romandie", "Deutschschweiz", "Ticino", "Greater Zurich", "Basel region", "Lake Geneva", "Central Switzerland", "Eastern Switzerland", "Mittelland"). Whatever their profession, take the role titles and the skills, tools, systems and certifications from their own CV, not from IT: quality_stack_keywords are the ones that make a job a better match for them ("sql" for an analyst, "bls" for a nurse, "datev" for an accountant). jobs_board_search_queries and google_jobs.queries are plain search phrases (3 to 6). locations.top_tier holds the cities they want most, country_wide the rest of that country, abroad other cities they'd move to. remote_excluded_regions lists regions whose "remote" jobs exclude them. google_jobs.locations uses SerpApi canonical names ("Zurich,Zurich,Switzerland") with the place's own language code ("de" for Zurich, "fr" for Geneva, "en" for London).
4. preferences.disqualifying_languages: languages a job may require that the user doesn't speak well enough to work in. excluded_companies: companies to skip (their current employer, and any the note names). work_rights: where they can work without a visa, from their citizenship or permits in the CV or note: their own country (a country name, lower case), and \"eu\" when they are an EU citizen; [] when the CV does not say. Never assume it from where they live now.
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
// The Profile and standard answers: the Notion pages once Notion is connected (the only copy). Before that (Trying, see
// lib/notion-gate.js) this Mac's profile.md / answers.md, which lib/migrate.js moves into Notion at connect.
export async function profileTexts(storage) {
  if (!notionGate.connected(storage)) return {profile: storage.readText('profile.md'), answers: storage.readText('answers.md')};
  const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
  const [profile, answers] = await Promise.all([notion.pageText(token, ids.NOTION_PROFILE_PAGE_ID),
    ids.NOTION_ANSWERS_PAGE_ID ? notion.pageText(token, ids.NOTION_ANSWERS_PAGE_ID) : '']);  // kept pages (lib/notion.js)
  return {profile, answers};
}
// Trying: the strategy's Profile (with its contact section) and standard answers are written to this Mac. null leaves a
// file as it is; backup first copies the files being replaced to backup/strategy-<stamp>/ and returns that folder (else null).
export function saveLocal(storage, {profile = null, answers = null}, {backup = false} = {}) {
  const files = [['profile.md', profile], ['answers.md', answers]].filter(([, text]) => text != null);
  let folder = null;
  if (backup) {
    const there = files.filter(([name]) => storage.readText(name));
    if (there.length) {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
      folder = storage.path(`backup/strategy-${stamp}`);
      fs.mkdirSync(folder, {recursive: true});
      for (const [name] of there) fs.writeFileSync(path.join(folder, name), storage.readText(name), {mode: 0o600});
    }
  }
  for (const [name, text] of files) storage.writeText(name, text);
  return folder;
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
export const ROLE_TERM = /^\p{L}[\p{L}0-9+#.\- ]{1,38}[\p{L}0-9+#]$/iu;   // any language's letters: "ingénieur système", "systemtechniker"
const escapeRegex = term => term.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
export function addRoles(storage, terms, deps) {
  const wanted = [...new Set((Array.isArray(terms) ? terms : []).map(term => String(term).trim().toLowerCase()).filter(term => ROLE_TERM.test(term)))].slice(0, 10);
  const list = search => search.role_keywords || [];
  return widen(storage, wanted.map(term => ({label: term, fragment: escapeRegex(term)})), list,
    (search, entries) => ({...search, role_keywords: [...list(search), ...entries]}), deps);
}

// Places the app offered after a search (src/coverage.py PLACE_OPTIONS): the caller passes the offered fragments only. They join
// locations.abroad, the same list the Berlin/London/Dubai of the starter settings sit in.
export function addPlaces(storage, offered, deps) {
  // One bullet per name ("dublin", "cork"), so the Notion page stays readable instead of showing one long /regex/.
  const parts = (Array.isArray(offered) ? offered : []).filter(item => item && typeof item.fragment === 'string' && item.fragment.length <= 600
    && !/[^\w\\|.\s\u00c0-\u017f\[\]-]/.test(item.fragment))
    .flatMap(item => item.fragment.split('|').filter(Boolean).map(fragment => [fragment.toLowerCase(), {label: String(item.place || fragment), fragment}]));
  const wanted = [...new Map(parts).values()].slice(0, 60);
  const list = search => search.locations?.abroad || [];
  return widen(storage, wanted, list,
    (search, entries) => ({...search, locations: {...search.locations, abroad: [...list(search), ...entries]}}), deps);
}

// The shared shape of both: sync the page, change the cached file, publish the page, check the change survived (a search can put the old file back).
async function widen(storage, wanted, list, change, {run, ensurePage, writePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (!wanted.length) return {added: []};
  // A search (Focus refresh, the daily run) syncs the page into the cache first; right after our write Notion can still list the old blocks, so
  // that sync puts the old settings back. The page is right a moment later: read it again and redo the change, a few times, before giving up.
  let lost = [], first = null;
  for (let attempt = 0; attempt < ADD_ROLES_ATTEMPTS; attempt++) {
    if (attempt) await wait(2000 * attempt);
    await run(storage, ['src.notion.search_settings', 'sync']);
    const before = storage.readText('config/search.json') || '{}';
    const search = JSON.parse(before);
    const have = new Set(list(search).map(entry => String(entry).toLowerCase()));
    const added = wanted.filter(item => !have.has(item.fragment.toLowerCase()));
    if (!added.length) return {added: first || []};
    first ||= [...new Set(added.map(item => item.label))];
    storage.writeText('config/search.json', JSON.stringify(change(search, added.map(item => item.fragment)), null, 2) + '\n');
    try {
      await publishSearchSettings(storage, {run, ensurePage, writePage});
      // The page is rendered from the cached file: if a search rewrote that file from an older copy of the page in between, the terms are gone from both
      // and the call would still say it worked (seen in the strategy e2e suite). Check, and try again.
      const kept = new Set(list(JSON.parse(storage.readText('config/search.json') || '{}')).map(entry => String(entry).toLowerCase()));
      lost = [...new Set(added.filter(item => !kept.has(item.fragment.toLowerCase())).map(item => item.label))];
      if (!lost.length) return {added: first};
    } catch (error) {
      storage.writeText('config/search.json', before);
      throw error;
    }
  }
  throw new Error(`A search changed your settings while they were being saved (${lost.join(', ')} did not stay). Try again.`);
}
const ADD_ROLES_ATTEMPTS = 3;

// The other way to more jobs (owner, 6 Oct 2026: "his strategy may be what stops the app finding jobs"): drop an excluded title word or a
// language that rules jobs out, after the app said how many jobs it costs (src/coverage.py). Same care as widen: the page is read first,
// both cached files change, the page is published, the change is checked; Notion refusing puts the files back.
export async function loosen(storage, {excludes = [], languages = []}, {run, ensurePage, writePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const lower = list => new Set(list.map(item => String(item).toLowerCase()));
  const dropWords = lower(excludes), dropLanguages = lower(languages);
  if (!dropWords.size && !dropLanguages.size) return {removed: []};
  for (let attempt = 0; attempt < ADD_ROLES_ATTEMPTS; attempt++) {
    if (attempt) await wait(2000 * attempt);
    await run(storage, ['src.notion.search_settings', 'sync']);
    const searchBefore = storage.readText('config/search.json') || '{}', prefsBefore = storage.readText('config/preferences.json') || '{}';
    const search = JSON.parse(searchBefore), prefs = JSON.parse(prefsBefore);
    const words = search.title_exclude_keywords || [], spoken = prefs.disqualifying_languages || [];
    const removed = [...words.filter(word => dropWords.has(String(word).toLowerCase())), ...spoken.filter(language => dropLanguages.has(String(language).toLowerCase()))];
    if (!removed.length) return {removed: []};
    storage.writeText('config/search.json', JSON.stringify({...search, title_exclude_keywords: words.filter(word => !dropWords.has(String(word).toLowerCase()))}, null, 2) + '\n');
    storage.writeText('config/preferences.json', JSON.stringify({...prefs, disqualifying_languages: spoken.filter(language => !dropLanguages.has(String(language).toLowerCase()))}, null, 2) + '\n');
    try {
      await publishSearchSettings(storage, {run, ensurePage, writePage});
      const still = [...(JSON.parse(storage.readText('config/search.json') || '{}').title_exclude_keywords || []), ...(JSON.parse(storage.readText('config/preferences.json') || '{}').disqualifying_languages || [])]
        .filter(item => dropWords.has(String(item).toLowerCase()) || dropLanguages.has(String(item).toLowerCase()));
      if (!still.length) return {removed};
    } catch (error) {
      storage.writeText('config/search.json', searchBefore);
      storage.writeText('config/preferences.json', prefsBefore);
      throw error;
    }
  }
  throw new Error('A search changed your settings while they were being saved. Try again.');
}

// Tune my strategy: the changes the engine proposed from the user's outcomes (src/tune.py) and the user ticked. The caller
// passes proposals the engine produced again just now, never the window's copy, so only an offered change is ever written.
// Same loop as widen(): sync the page, change the cache, publish, check the change stayed.
export function tuned(search, chosen) {
  const has = (list, fragment) => list.some(entry => String(entry).toLowerCase() === fragment.toLowerCase());
  return chosen.every(item => item.kind === 'exclude_title' ? has(search.title_exclude_keywords || [], item.fragment)
    : !has(item.kind === 'drop_role' ? search.role_keywords || [] : search.locations?.[item.list] || [], item.fragment));
}
export function applyTune(search, chosen) {
  const next = {...search, locations: {...search.locations}};
  const without = (list, fragment) => (list || []).filter(entry => String(entry).toLowerCase() !== fragment.toLowerCase());
  for (const item of chosen) {
    if (item.kind === 'drop_role') next.role_keywords = without(next.role_keywords, item.fragment);
    else if (item.kind === 'drop_place' && ['top_tier', 'country_wide', 'abroad'].includes(item.list)) next.locations[item.list] = without(next.locations[item.list], item.fragment);
    else if (item.kind === 'exclude_title' && !tuned(next, [item])) next.title_exclude_keywords = [...(next.title_exclude_keywords || []), item.fragment];
  }
  return next;
}
// The guard behind Tune's Apply: the window sends ids only; the changes written are those of a fresh engine answer that match.
export const chooseOffered = (fresh, ids) => {
  const wanted = new Set(Array.isArray(ids) ? ids.map(String) : []);
  return {chosen: (fresh || []).filter(item => wanted.has(item.id)), asked: wanted.size};
};
export async function retune(storage, chosen, {run, ensurePage, writePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (!chosen.length) return {changed: []};
  for (let attempt = 0; attempt < ADD_ROLES_ATTEMPTS; attempt++) {
    if (attempt) await wait(2000 * attempt);
    await run(storage, ['src.notion.search_settings', 'sync']);
    const before = storage.readText('config/search.json') || '{}';
    const search = JSON.parse(before);
    if (tuned(search, chosen)) return {changed: chosen.map(item => item.label)};
    storage.writeText('config/search.json', JSON.stringify(applyTune(search, chosen), null, 2) + '\n');
    try {
      await publishSearchSettings(storage, {run, ensurePage, writePage});
      if (tuned(JSON.parse(storage.readText('config/search.json') || '{}'), chosen)) return {changed: chosen.map(item => item.label)};
    } catch (error) {
      storage.writeText('config/search.json', before);
      throw error;
    }
  }
  throw new Error('A search changed your settings while they were being saved. Try again.');
}

// The Strategy page's "What you're targeting", edited in the app (owner, 7 Oct 2026: "Edit preferences" opened the Profile page, where
// the places shown on the card are not, and he wants to edit here, not in Notion). A fixed set of lists; the window sends, per list,
// the stored fragments to remove and the words to add. Same loop as retune(): sync the page, change the cache, publish, check it stayed.
export const EDITABLE_LISTS = {roles: ['role_keywords'], places: ['locations', 'top_tier'], country: ['locations', 'country_wide'],
  abroad: ['locations', 'abroad'], stack: ['quality_stack_keywords']};
const listAt = (search, path) => (path.length === 1 ? search[path[0]] : search[path[0]]?.[path[1]]) || [];
const lowerSet = list => new Set(list.map(item => String(item).toLowerCase()));
export function cleanEdits(edits) {
  const out = {};
  for (const [name, edit] of Object.entries(edits && typeof edits === 'object' ? edits : {})) {
    if (!EDITABLE_LISTS[name] || !edit || typeof edit !== 'object') continue;
    const add = [...new Set((Array.isArray(edit.add) ? edit.add : []).map(word => String(word).trim().toLowerCase())
      .filter(word => word.length >= 2 && word.length <= 60 && !/[\n\r]/.test(word)).map(escapeRegex))].slice(0, 20);
    const remove = (Array.isArray(edit.remove) ? edit.remove : []).map(String).filter(Boolean).slice(0, 100);
    if (add.length || remove.length) out[name] = {add, remove};
  }
  return out;
}
export function applyEdits(search, edits) {
  const next = {...search, locations: {...search.locations}};
  for (const [name, {add, remove}] of Object.entries(edits)) {
    const path = EDITABLE_LISTS[name], gone = lowerSet(remove);
    const kept = listAt(next, path).filter(item => !gone.has(String(item).toLowerCase()));
    const have = lowerSet(kept);
    const list = [...kept, ...add.filter(item => !have.has(item.toLowerCase()))];
    if (path.length === 1) next[path[0]] = list; else next[path[0]][path[1]] = list;
  }
  return next;
}
export const edited = (search, edits) => Object.entries(edits).every(([name, {add, remove}]) => {
  const have = lowerSet(listAt(search, EDITABLE_LISTS[name]));
  return add.every(item => have.has(item.toLowerCase())) && remove.every(item => !have.has(item.toLowerCase()));
});
export async function editLists(storage, asked, {run, ensurePage, writePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const edits = cleanEdits(asked);
  if (!Object.keys(edits).length) return {changed: []};
  for (let attempt = 0; attempt < ADD_ROLES_ATTEMPTS; attempt++) {
    if (attempt) await wait(2000 * attempt);
    await run(storage, ['src.notion.search_settings', 'sync']);
    const before = storage.readText('config/search.json') || '{}';
    const search = JSON.parse(before);
    if (edited(search, edits)) return {changed: Object.keys(edits)};
    storage.writeText('config/search.json', JSON.stringify(applyEdits(search, edits), null, 2) + '\n');
    try {
      await publishSearchSettings(storage, {run, ensurePage, writePage});
      if (edited(JSON.parse(storage.readText('config/search.json') || '{}'), edits)) return {changed: Object.keys(edits)};
    } catch (error) {
      storage.writeText('config/search.json', before);
      throw error;
    }
  }
  throw new Error('A search changed your settings while they were being saved. Try again.');
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
  const searchChanges = [...listChanges('Roles', search.role_keywords, next.role_keywords), ...listChanges('Level', search.level, next.level),
    ...listChanges('Job board searches', search.jobs_board_search_queries, next.jobs_board_search_queries), ...where,
    ...listChanges('Excluded titles', search.title_exclude_keywords, next.title_exclude_keywords),
    ...listChanges('Key skills and tools', search.quality_stack_keywords, next.quality_stack_keywords)];
  const prefs = draft.preferences || {};
  const filterChanges = [...listChanges('Languages you don\'t work in', preferences.disqualifying_languages, prefs.disqualifying_languages),
    ...listChanges('Excluded companies', preferences.excluded_companies, prefs.excluded_companies),
    ...listChanges('Work without a visa in', preferences.work_rights, prefs.work_rights)];
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

// Strategy builder: CV (PDF) + the wizard's answers -> a draft Profile, standard answers and search
// settings, in one Claude call. Nothing is saved until the user reviews and accepts the draft.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import {REPO} from './pipeline.js';

export const MODEL = 'claude-sonnet-5';
const PRICE = {input: 2, output: 10}; // USD per million tokens, claude-sonnet-5

const list = {type: 'array', items: {type: 'string'}};
const object = (properties) => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
export const DRAFT_SCHEMA = object({
  summary: {type: 'string'},
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
});

function template() {
  const text = fs.readFileSync(path.join(REPO, 'docs', 'notion-profile-template.md'), 'utf8');
  return text.slice(text.indexOf('## 👤'));
}

const INSTRUCTIONS = `You set up Job Pilotto, a job-search assistant, for a new user from their CV and their answers to a short questionnaire.

Write:
1. profile_markdown: the user's Profile, following the "Profile — CV and Preferences" template's headings. Facts only from the CV and the answers; mark anything unknown with ❓ (the app treats ❓ as "ask the user", never as a fact).
2. answers_markdown: their standard application answers, following the "Application Answers" template, same rule for ❓. Include a short "Cover letter style" section inferred from how the CV is written.
3. search: what the job crawler looks for. Values in role_keywords, title_exclude_keywords, board_discovery_keywords, quality_stack_keywords, locations and remote_excluded_regions are case-insensitive regex fragments in the style of the example (e.g. "z[uü]rich", "\\\\bsre\\\\b", "platform engineer"). jobs_board_search_queries and google_jobs.queries are plain search phrases (3 to 6). locations.top_tier holds the cities they want most, country_wide the rest of that country, abroad other cities they'd move to. remote_excluded_regions lists regions whose "remote" jobs exclude them. google_jobs.locations uses SerpApi canonical names ("Zurich,Zurich,Switzerland") with the place's own language code ("de" for Zurich, "fr" for Geneva, "en" for London).
4. preferences.disqualifying_languages: languages a job may require that the user doesn't speak well enough to work in. excluded_companies: companies they asked to skip (e.g. their current employer).
5. summary: 2 to 3 plain sentences telling the user what you set up. open_questions: what they should still answer, short.`;

// The draft streams in, in schema order; progress is how much of it has arrived and which part is being
// written. The expected length starts at a typical draft and then follows this user's last one.
export const TYPICAL_DRAFT_CHARS = 40000;
const PARTS = [['"summary"', 'Writing the summary'], ['"profile_markdown"', 'Writing your Profile'],
  ['"answers_markdown"', 'Writing your standard answers'], ['"open_questions"', 'Listing what to check'],
  ['"search"', 'Choosing search settings'], ['"preferences"', 'Setting filters']];

export function progress(text, expected = TYPICAL_DRAFT_CHARS) {
  let part = 'Reading your CV';
  for (const [key, label] of PARTS) if (text.includes(key)) part = label;
  return {part, percent: Math.min(97, Math.round(text.length / expected * 100)), chars: text.length};
}

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
      {type: 'text', text: `<questionnaire>\n${JSON.stringify(answers, null, 2)}\n</questionnaire>\n\n<templates>\n${template()}\n</templates>\n\n<example_search_settings>\n${example}\n</example_search_settings>`},
    ]}],
    output_config: {format: {type: 'json_schema', schema: DRAFT_SCHEMA}},
  };
  let response;
  const expected = storage.settings().draftChars || TYPICAL_DRAFT_CHARS;
  if (onProgress && anthropic.messages.stream) {
    const stream = anthropic.messages.stream(request);
    stream.on('text', (_, snapshot) => onProgress(progress(snapshot, expected)));
    response = await stream.finalMessage();
  } else {
    response = await anthropic.messages.create(request);
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read this CV');
  if (response.stop_reason === 'max_tokens') throw new Error('The draft was cut off; try again');
  const text = response.content.find(block => block.type === 'text').text;
  const result = JSON.parse(text);
  storage.saveSettings({draftChars: text.length});  // the next estimate follows this draft
  const usage = response.usage || {};
  result.usd = Math.round(((usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output) / 1e4) / 100;
  return result;
}

// Accepting a draft writes the Profile, answers and the pipeline's settings into the user's folder.
export function save(storage, accepted) {
  storage.writeText('profile.md', accepted.profile_markdown.trim() + '\n');
  storage.writeText('answers.md', accepted.answers_markdown.trim() + '\n');
  const current = JSON.parse(storage.readText('config/search.json') || '{}');
  const google = {...(current.google_jobs || {}), ...accepted.search.google_jobs,
    searches_per_run: current.google_jobs?.searches_per_run ?? 1, min_searches_left: current.google_jobs?.min_searches_left ?? 20};
  storage.writeText('config/search.json', JSON.stringify({...current, ...accepted.search, google_jobs: google}, null, 2) + '\n');
  const preferences = JSON.parse(storage.readText('config/preferences.json') || '{}');
  storage.writeText('config/preferences.json', JSON.stringify({...preferences, ...accepted.preferences}, null, 2) + '\n');
}

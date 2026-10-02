// A replaced CV after setup (Strategy → Replace CV…): what follows it and what doesn't.
// - The file itself: new applications upload the new cv.pdf at once (nothing to do).
// - The Profile in Notion: one Claude call compares the previous and the new CV and suggests line edits to the
//   Profile (update / add / remove); the user accepts each one, and only those lines change. Never a rebuild.
// - Not changed: searches and preferences, existing matches and scores, applications already sent.
// The previous PDF is kept as cv.previous.pdf (a large file, on this Mac only) until the next replacement.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import * as notion from './notion.js';

export const MODEL = process.env.JOB_PILOTTO_MODEL_OVERRIDE || 'claude-sonnet-5-5';   // the override: the end-to-end journey (desktop/e2e)
const PRICE = {input: 2, output: 10};  // USD per million tokens
const usd = usage => (usage?.billing === 'subscription' ? 0 : Math.round(((usage?.input_tokens || 0) * PRICE.input + (usage?.output_tokens || 0) * PRICE.output) / 1e4) / 100);  // Claude Code: the user's plan, $0
export const PREVIOUS = 'cv.previous.pdf';

// Replace the CV: the one there now becomes cv.previous.pdf (only after setup, when there's a Profile to compare).
export function replace(storage, file, name, now = new Date()) {
  const current = storage.path('cv.pdf'), setUp = !!storage.settings().setupDone;
  if (setUp && fs.existsSync(current)) fs.copyFileSync(current, storage.path(PREVIOUS));
  fs.copyFileSync(file, current);
  const previous = storage.settings().cvName || '';
  storage.saveSettings({cvName: name, ...(setUp ? {cvChange: {previous, at: now.toISOString()}} : {})});
  return {name, review: setUp && fs.existsSync(storage.path(PREVIOUS))};
}

const string = {type: 'string'};
export const SCHEMA = {type: 'object', additionalProperties: false, required: ['summary', 'suggestions'], properties: {
  summary: string,
  suggestions: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['kind', 'line', 'text', 'why'], properties: {
    kind: {type: 'string', enum: ['update', 'add', 'remove']}, line: {type: 'integer'}, text: string, why: string}}}}};

const INSTRUCTIONS = `The user replaced their CV. Document 1 is the previous CV, document 2 the new one. Below them are the
lines of their job-search Profile, numbered. Find what the new CV changes compared with the previous one (new or
changed roles, dates, titles, skills, certifications, numbers, links, contact details, removed items) and suggest the
smallest edits to the Profile that keep it true to the new CV:
- update: line = the line to rewrite, text = the whole new line (keep its style and emojis)
- add: line = the line to insert after (a heading or the last line of the right section), text = the new line
- remove: line = the line that is no longer true, text = ""
Only suggest what the CV change supports. Never touch lines about goals, preferences, salary, locations or strategy
unless the new CV contradicts them. Nothing changed in substance -> no suggestions. summary: one sentence on what
changed in the CV. why: a few words, quoting the CV.`;

// -> {summary, suggestions: [{kind, line, text, why, block: {id, type, text, parent}}], usd}
export async function review(storage, apiKey, {client = null, fetcher} = {}) {
  const token = storage.secret('NOTION_TOKEN'), page = storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;
  if (!token || !page) throw new Error('Connect Notion first: the Profile is compared with your CV there');
  if (!fs.existsSync(storage.path(PREVIOUS))) throw new Error('The previous CV is not on this computer, so there is nothing to compare');
  const lines = (await notion.textBlocks(token, page, fetcher)).filter(block => block.text.trim());
  const pdf = name => ({type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(storage.path(name)).toString('base64')}});
  const anthropic = client || new Anthropic({apiKey});
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 8000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: [pdf(PREVIOUS), pdf('cv.pdf'),
      {type: 'text', text: `Profile lines:\n${lines.map((block, n) => `[${n}] ${block.type.startsWith('heading') ? '## ' : ''}${block.text}`).join('\n')}`}]}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}},
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to compare these CVs');
  const result = JSON.parse(response.content.find(block => block.type === 'text').text);
  const suggestions = result.suggestions
    .filter(s => Number.isInteger(s.line) && lines[s.line] && (s.kind === 'remove' || s.text.trim()))
    .map((s, n) => ({...s, id: n, block: lines[s.line]}));
  return {summary: result.summary, suggestions, usd: usd(response.usage)};
}

// The accepted suggestions, written to the Profile in Notion (only those lines). -> {applied, failed: [why]}
export async function apply(storage, accepted, fetcher) {
  const token = storage.secret('NOTION_TOKEN');
  let applied = 0;
  const failed = [];
  for (const s of accepted) {
    try {
      if (s.kind === 'update') await notion.setBlockText(token, s.block, s.text, fetcher);
      else if (s.kind === 'remove') await notion.deleteBlock(token, s.block.id, fetcher);
      else await notion.insertBulletsAfter(token, s.block.parent, s.block.id, [s.text], fetcher);
      applied += 1;
    } catch (error) { failed.push(`${s.text || s.block.text}: ${error.message}`); }
  }
  if (!failed.length) storage.saveSettings({cvChange: null});
  return {applied, failed};
}

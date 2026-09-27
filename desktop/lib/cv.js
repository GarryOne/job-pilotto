// Tailored CVs. The base CV is data (cv/cv.json in the user's folder: summary, jobs, bullets, skills, links),
// made once from the CV PDF (importPdf) or by hand; cv/template.js turns it into HTML and Chromium prints the PDF.
// Tailoring one job = one Claude call that may rewrite the summary, reorder, reword or drop bullets and reorder
// skills, using only facts already in the CV (or confirmed in the Profile). The code then checks the result:
// same jobs, titles, dates and places; no number that wasn't there; unknown terms flagged for review.
//
//   cv/cv.json, cv/assets/ (photo, logos), cv/style.css (optional own design)
//   cv/tailored/<job code>.json (the tailored data, what changed and why) and .pdf
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {render} from '../cv/template.js';

export const MODEL = 'claude-sonnet-5';
const PRICE = {input: 2, output: 10};  // USD per million tokens
const usd = usage => Math.round(((usage?.input_tokens || 0) * PRICE.input + (usage?.output_tokens || 0) * PRICE.output) / 1e4) / 100;

const string = {type: 'string'};
const list = {type: 'array', items: string};
const object = properties => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});

export const dir = storage => storage.path('cv');
const tailoredDir = storage => path.join(dir(storage), 'tailored');
export const baseCv = storage => { try { return JSON.parse(fs.readFileSync(path.join(dir(storage), 'cv.json'), 'utf8')); } catch { return null; } };
const style = storage => { try { return fs.readFileSync(path.join(dir(storage), 'style.css'), 'utf8'); } catch { return ''; } };

// ---------- import: CV PDF -> cv.json ----------
export const IMPORT_SCHEMA = object({
  name: string, location: string, summary: string,
  links: {type: 'array', items: object({text: string, href: string})},
  jobs: {type: 'array', items: object({company: string, href: string, roles: {type: 'array', items: object({
    title: string, period: string, place: string, intro: string, bullets: list, skills: string})}})},
  education: {type: 'array', items: object({school: string, degree: string, period: string})},
  skills: string, languages: string,
});

const IMPORT_INSTRUCTIONS = `Transcribe this CV into the JSON schema, verbatim: same words, same order, nothing added, fixed or
summarised. One entry in jobs per employer, most recent first; several positions at one employer are several roles.
period like "Mar 2024 – Present"; place is the city/country or "Remote"; intro is a one-line description written above
the bullets ("" if none); skills is a role's own "Skills:" line ("" if none). Top-level skills/languages only if the CV has
such sections. links: phone, email and profile URLs shown in the header (href as tel:, mailto: or https://). Keep the CV's
bold figures as **bold**. Use "" for anything the CV doesn't show.`;

export async function importPdf(storage, apiKey, client = null) {
  const pdf = fs.readFileSync(storage.path('cv.pdf'));
  const anthropic = client || new Anthropic({apiKey});
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 16000, system: IMPORT_INSTRUCTIONS,
    messages: [{role: 'user', content: [
      {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64')}},
      {type: 'text', text: 'Transcribe this CV.'}]}],
    output_config: {format: {type: 'json_schema', schema: IMPORT_SCHEMA}},
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read this CV');
  const data = JSON.parse(response.content.find(block => block.type === 'text').text);
  const clean = {...data, jobs: data.jobs.map(({href, ...job}) => ({...job, ...(href ? {href} : {}),
    roles: job.roles.map(({intro, skills, ...r}) => ({...r, ...(intro ? {intro} : {}), ...(skills ? {skills} : {})}))}))};
  for (const key of ['skills', 'languages', 'location', 'summary']) if (!clean[key]) delete clean[key];
  fs.mkdirSync(dir(storage), {recursive: true});
  fs.writeFileSync(path.join(dir(storage), 'cv.json'), JSON.stringify(clean, null, 2) + '\n', {mode: 0o600});
  return {cv: clean, usd: usd(response.usage)};
}

// ---------- tailoring ----------
export const TAILOR_SCHEMA = object({
  summary: string,
  jobs: {type: 'array', items: object({company: string, roles: {type: 'array', items: object({
    title: string,
    bullets: {type: 'array', items: object({source: {type: 'integer'}, text: string})},
    skills: string,
  })}})},
  changes: {type: 'array', items: object({where: string, change: string, why: string})},
});

const TAILOR_INSTRUCTIONS = `You tailor a candidate's CV to one job posting. The CV is given as JSON; every bullet has an index.
Return the same jobs and roles, in the same order, with the same company and title strings. For each role you may:
- reorder bullets so the ones most relevant to the posting come first (keep each bullet's "source" index),
- reword a bullet to use the posting's vocabulary where it describes the same work (e.g. "incident management" when the
  bullet is about incidents), keeping it about as long or shorter,
- drop at most 2 bullets per role that are irrelevant to this posting,
- reorder the role's skills line (same items; "" if the role has none).
Rewrite the summary (2–3 sentences, similar length) to lead with what this posting asks for, keeping the CV's own
role title at its start (e.g. "Site Reliability Engineer …"): the candidate's identity doesn't change per job.
Rewording changes emphasis and vocabulary, never claims: don't replace a concrete detail with an outcome the CV doesn't
state (e.g. "reduced alert noise", "improved signal quality", "at scale"), and prefer the smallest edit that works.
Hard rules: use only facts from the CV and the facts the Profile states as confirmed; never use anything marked ❓, never
add a tool, technology, certification, number, employer or responsibility that isn't there, never change numbers (keep
**bold** figures), never inflate scope ("led" only where the CV says led). Same language as the CV. The result must fit
the same pages: don't make the CV longer.
changes: 3–8 short items for the candidate: where (e.g. "Summary", "Sonar · Production Engineer"), what changed, and why
(which part of the posting it answers).`;

// The CV as the model sees it: bullets numbered per role.
const numbered = cv => ({summary: cv.summary || '', jobs: cv.jobs.map(job => ({company: job.company, roles: job.roles.map(r => ({
  title: r.title, period: r.period, ...(r.intro ? {intro: r.intro} : {}),
  bullets: r.bullets.map((text, index) => ({index, text})), skills: r.skills || ''}))})),
  ...(cv.skills ? {skills: cv.skills} : {})});

export async function tailor(storage, posting, apiKey, {client = null, feedback = ''} = {}) {
  const cv = baseCv(storage);
  if (!cv) throw new Error('No base CV yet');
  const profile = storage.readText('profile.md');
  const anthropic = client || new Anthropic({apiKey});
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 12000, system: TAILOR_INSTRUCTIONS,
    messages: [{role: 'user', content: `<cv>\n${JSON.stringify(numbered(cv), null, 1)}\n</cv>\n\n<profile>\n${profile.slice(0, 40000)}\n</profile>\n\n` +
      `<posting>\n${posting.title} at ${posting.company}${posting.location ? ` (${posting.location})` : ''}\n\n${(posting.description || '(no description stored: tailor to the title)').slice(0, 30000)}\n</posting>` +
      (feedback ? `\n\n<feedback>${feedback}</feedback>` : '')}],
    output_config: {format: {type: 'json_schema', schema: TAILOR_SCHEMA}},
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to tailor this CV');
  if (response.stop_reason === 'max_tokens') throw new Error('The tailored CV was cut off; try again');
  return {result: JSON.parse(response.content.find(block => block.type === 'text').text), usd: usd(response.usage)};
}

// ---------- checks and diff ----------
const plain = text => String(text || '').replace(/\*\*/g, '');
const numbers = text => plain(text).match(/\d+(?:[.,]\d+)*/g) || [];
const words = text => new Set(plain(text).toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).map(w => w.replace(/\.+$/, '')).filter(Boolean));
// Tool- or product-like words (capital inside or after the first letter, or digits): must already be known.
const terms = text => [...new Set(plain(text).split(/[^\p{L}\p{N}+#./-]+/u).map(w => w.replace(/[.,-]+$/, ''))
  .filter(w => w.length > 1 && /[A-Z0-9]/.test(w.slice(1)) && !/^\d+$/.test(w)))];
const setOf = line => new Set(String(line || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Words with their **bold** state resolved: [{word, bold}], "**" markers removed.
function tokens(text) {
  let inside = false;
  return String(text || '').split(/\s+/).filter(Boolean).map(raw => {
    const bold = inside || raw.startsWith('**');
    if ((raw.match(/\*\*/g) || []).length % 2) inside = !inside;
    return {word: raw.replace(/\*\*/g, ''), bold};
  });
}
const wordsHtml = list => list.map(t => t.bold ? `<b>${escape(t.word)}</b>` : escape(t.word)).join(' ');

// Word-level diff as HTML: removed words first (<del>), then what replaced them (<ins>); bold kept.
// A mostly rewritten text reads better whole: the new text, with the old one underneath ("Before: …").
export function wordDiff(before, after) {
  const a = tokens(before), b = tokens(after);
  const table = Array.from({length: a.length + 1}, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i][j] = a[i].word === b[j].word ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  if (table[0][0] < 0.5 * Math.max(a.length, b.length))
    return `${wordsHtml(b)}<span class="before">Before: ${wordsHtml(a)}</span>`;
  const ops = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].word === b[j].word) { ops.push(['=', b[j]]); i++; j++; }
    else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) { ops.push(['-', a[i]]); i++; }
    else { ops.push(['+', b[j]]); j++; }
  }
  // Consecutive words of one kind become one <del>/<ins>; a replacement reads "old new".
  const parts = [];
  for (const [op, token] of ops) {
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.tokens.push(token); else parts.push({op, tokens: [token]});
  }
  return parts.map(({op, tokens: list}) => op === '=' ? wordsHtml(list) : `<${op === '-' ? 'del' : 'ins'}>${wordsHtml(list)}</${op === '-' ? 'del' : 'ins'}>`).join(' ');
}

// The model's answer applied to the base CV, after the checks. Returns the tailored CV, the same CV with
// review marks, and warnings (what was refused or needs a look).
export function applyTailoring(base, result, known = '') {
  const warnings = [];
  const vocabulary = words(JSON.stringify(base) + ' ' + known);
  const cvNumbers = new Set(numbers(JSON.stringify(base)));
  const unknownTerms = (text, where) => {
    // Known when the word, or each part of a compound like "50K/month" or "AWS-based", is already in the CV.
    const known = term => vocabulary.has(term.toLowerCase()) || term.split(/[/-]/).every(part => !part || vocabulary.has(part.toLowerCase()) || /^\d/.test(part));
    const unknown = terms(text).filter(term => !known(term));
    if (unknown.length) warnings.push(`${where}: new term${unknown.length > 1 ? 's' : ''} ${unknown.map(t => `"${t}"`).join(', ')}; check it is true`);
  };
  if (result.jobs.length !== base.jobs.length) throw new Error('The tailored CV changed the list of jobs');
  const cv = structuredClone(base), review = structuredClone(base);

  let summary = result.summary?.trim() || base.summary || '';
  if (numbers(summary).some(n => !cvNumbers.has(n))) { warnings.push('Summary: a new number appeared; kept your original summary'); summary = base.summary || ''; }
  else unknownTerms(summary, 'Summary');
  cv.summary = summary;
  review.summary = summary;
  if (plain(summary) !== plain(base.summary)) { review.summaryMark = true; review.summaryDiff = wordDiff(base.summary, summary); }

  base.jobs.forEach((job, j) => {
    const got = result.jobs[j];
    if (got.company.trim().toLowerCase() !== job.company.trim().toLowerCase() || got.roles.length !== job.roles.length)
      throw new Error(`The tailored CV changed the jobs (${job.company})`);
    job.roles.forEach((role, r) => {
      const where = `${job.company} · ${role.title}`;
      const seen = new Set();
      const bullets = [];
      for (const item of got.roles[r].bullets) {
        const original = role.bullets[item.source];
        if (original === undefined || seen.has(item.source)) continue;
        seen.add(item.source);
        let text = item.text.trim() || original;
        if (numbers(text).some(n => !numbers(original).includes(n))) {
          warnings.push(`${where}: a reworded bullet changed a number; kept the original wording`);
          text = original;
        } else if (text !== original) unknownTerms(text, where);
        bullets.push({text, source: item.source, original});
      }
      // Dropping is allowed (at most 2); losing more means the answer was incomplete: keep the rest in order.
      const dropped = role.bullets.map((text, index) => ({text, index})).filter(b => !seen.has(b.index));
      if (dropped.length > 2) {
        warnings.push(`${where}: ${dropped.length} bullets were left out; kept all but 2`);
        for (const b of dropped.slice(0, dropped.length - 2)) bullets.push({text: b.text, source: b.index, original: b.text});
        dropped.splice(0, dropped.length - 2);
      }
      let skills = got.roles[r].skills?.trim() || '';
      if (role.skills && !sameSet(setOf(skills), setOf(role.skills))) {
        if (skills) warnings.push(`${where}: skills line changed its items; kept the original`);
        skills = role.skills;
      }
      const tailoredRole = cv.jobs[j].roles[r];
      tailoredRole.bullets = bullets.map(b => b.text);
      if (role.skills) tailoredRole.skills = skills;
      const marked = review.jobs[j].roles[r];
      marked.bullets = bullets.map((b, position) => ({text: b.text, from: b.source,
        // Moved up: now above a bullet that used to come before it (not just shifted by a dropped one).
        mark: plain(b.text) !== plain(b.original) ? 'reworded' : bullets.slice(position + 1).some(later => later.source < b.source) ? 'moved' : 'kept',
        diff: plain(b.text) !== plain(b.original) ? wordDiff(b.original, b.text) : ''}));
      marked.dropped = dropped.map(b => b.text);
      if (role.skills) { marked.skills = skills; if (skills !== role.skills) { marked.skillsMark = true; marked.skillsDiff = escape(skills); } }
    });
  });
  return {cv, review, warnings};
}

// ---------- files ----------
const safeCode = code => String(code).replace(/[^a-z0-9]/gi, '');
const file = (storage, code, ext) => path.join(tailoredDir(storage), `${safeCode(code)}.${ext}`);
export const exists = (storage, code) => fs.existsSync(file(storage, code, 'pdf'));
export const load = (storage, code) => { try { return JSON.parse(fs.readFileSync(file(storage, code, 'json'), 'utf8')); } catch { return null; } };
export const pdfPath = (storage, code) => file(storage, code, 'pdf');

// The HTML for a CV (tailored, base or review), written next to the user's assets so images resolve.
export function writeHtml(storage, cv, name, {review = false} = {}) {
  fs.mkdirSync(tailoredDir(storage), {recursive: true});
  const target = path.join(tailoredDir(storage), name);
  fs.writeFileSync(target, render(cv, {style: style(storage), review, base: pathToFileURL(dir(storage) + path.sep).href}), {mode: 0o600});
  return target;
}

export function save(storage, code, record, pdf) {
  fs.mkdirSync(tailoredDir(storage), {recursive: true});
  fs.writeFileSync(file(storage, code, 'json'), JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
  fs.writeFileSync(file(storage, code, 'pdf'), pdf, {mode: 0o600});
}

// The tailored CV for a job page, if there is one (the extension uploads it instead of the base CV).
const pageKey = url => String(url || '').split('#')[0].replace(/\/+$/, '');
export function forUrl(storage, url) {
  const key = pageKey(url);
  if (!key) return null;
  let names = [];
  try { names = fs.readdirSync(tailoredDir(storage)).filter(n => n.endsWith('.json')); } catch { return null; }
  for (const name of names) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(tailoredDir(storage), name), 'utf8'));
      if (pageKey(record.job?.url) === key && fs.existsSync(file(storage, record.job.code, 'pdf'))) return record;
    } catch {}
  }
  return null;
}

// The review page: the tailored CV with its changes marked, the reasons, and a switch to see it clean.
export function reviewPage(storage, record) {
  // Marks are recomputed from the model's answer when it's kept, so older reviews get later diff improvements.
  const base = baseCv(storage);
  let marked = record.review, warnings = record.warnings;
  if (record.result && base) try {
    const again = applyTailoring(base, record.result, storage.readText('profile.md'));
    marked = again.review;
    warnings = [...again.warnings, ...record.warnings.filter(w => /too full/.test(w))];
  } catch {}
  const cvHtml = render(marked, {style: style(storage), review: true, base: pathToFileURL(dir(storage) + path.sep).href});
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const changes = record.changes.map(c => `<li><b>${esc(c.where)}</b>: ${esc(c.change)}<div class="why">${esc(c.why)}</div></li>`).join('');
  const warningList = warnings.map(w => `<li>⚠️ ${esc(w)}</li>`).join('');
  const panel = `<aside id="jp-panel">
    <div class="jp-title">Tailored CV · ${esc(record.job.title)} · ${esc(record.job.company)}</div>
    <div class="jp-meta">${new Date(record.createdAt).toLocaleString()} · ${esc(record.model)} · $${record.usd.toFixed(2)}</div>
    <div class="jp-actions"><a href="${esc(pathToFileURL(pdfPath(storage, record.job.code)).href)}" target="_blank">Open the PDF</a>
      <label><input type="checkbox" id="jp-clean"> Hide highlights</label></div>
    <div class="jp-legend"><span class="k-rew">reworded</span> <span class="k-ins">added</span> <span class="k-del">removed</span> <span class="k-mov">moved up</span></div>
    ${warningList ? `<ul class="jp-warn">${warningList}</ul>` : ''}
    <div class="jp-h">What changed and why</div><ul class="jp-changes">${changes}</ul></aside>`;
  const css = `<style>
    body.review { background: #e9edf2; display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 18px 18px 18px 360px; }
    body.review .page { background: #fff; box-shadow: 0 2px 14px #0002; }
    body.review .page:not(.fixed) { width: 595pt; padding: 16mm; }
    #jp-panel { position: fixed; left: 0; top: 0; bottom: 0; width: 340px; overflow: auto; background: #132439; color: #e8eef6;
      font: 13px/1.45 -apple-system, system-ui, sans-serif; padding: 18px; box-sizing: border-box; }
    #jp-panel .jp-title { font-weight: 700; font-size: 15px; } #jp-panel .jp-meta { color: #9fb2c8; font-size: 12px; margin: 4px 0 12px; }
    #jp-panel .jp-actions { display: flex; gap: 14px; align-items: center; margin-bottom: 10px; }
    #jp-panel a { color: #ffb27a; } #jp-panel label { cursor: pointer; }
    #jp-panel .jp-legend span { display: inline-block; padding: 1px 6px; border-radius: 4px; margin: 2px 2px 0 0; font-size: 12px; color: #222; }
    .k-rew { background: #fff4c2; } .k-ins { background: #c9f3d2; } .k-del { background: #ffe0dc; text-decoration: line-through; } .k-mov { background: #d6e8ff; }
    #jp-panel .jp-h { font-weight: 700; margin: 16px 0 6px; } #jp-panel ul { list-style: none; } #jp-panel li { margin: 0 0 9px; }
    #jp-panel .why { color: #9fb2c8; font-size: 12px; } #jp-panel .jp-warn li { color: #ffd27a; }
    @media print { #jp-panel { display: none; } }</style>
    <script>addEventListener('DOMContentLoaded', () => document.getElementById('jp-clean').addEventListener('change', e => document.body.classList.toggle('clean', e.target.checked)));</script>`;
  const html = cvHtml.replace('</head>', `${css}</head>`).replace(/(<body[^>]*>)/, `$1${panel}`);
  fs.mkdirSync(tailoredDir(storage), {recursive: true});
  const target = file(storage, record.job.code, 'review.html');
  fs.writeFileSync(target, html, {mode: 0o600});
  return target;
}

// Endpoints for the Job Pilotto Chrome extension (extension/ in the repo).
//
//   GET  /extension/kit?url=<job page>  the job's Applications row and its drafted kit, read from Notion
//   POST /extension/answer {url, fields, page_text}
//                                       one Claude call answers every field of the live form from the
//                                       Profile, Application Answers and the kit; checks eligibility
//   POST /extension/applied {url}       mark the job Applied (the daily workflow's apply mode, by URL)
//
// Every call needs `Authorization: Bearer <EXTENSION_TOKEN>` (a Worker secret). Responses allow any
// origin, so the extension needs no host permission for the Worker; the token is the access control.

import Anthropic from '@anthropic-ai/sdk';

const KIT_HEADING = '📝 Application kit';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
// USD per million tokens, for the cost shown to the user and logged (claude-sonnet-5-5).
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

function sameSecret(given, expected) {
  if (!expected || typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function notion(env, path, method = 'GET', body) {
  if (env.notionCall) return env.notionCall(path, method, body);  // the desktop app: its paced, retrying Notion client
  return fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Notion ${path} failed: ${response.status}`);
    return response.json();
  });
}

const plain = (rich) => (rich || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

// The part of a job URL that survives tracking parameters and the board's alternate link forms:
// Greenhouse's numeric job id, or Lever's and Ashby's posting UUID. Null for anything else.
export function jobKey(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const greenhouse = /greenhouse\.io$/.test(parsed.hostname) &&
    (/\/jobs\/(\d+)/.exec(parsed.pathname)?.[1] || parsed.searchParams.get('gh_jid') || parsed.searchParams.get('token'));
  if (greenhouse) return greenhouse;
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(parsed.pathname)?.[0] || null;
}

async function findRow(env, url) {
  if (!env.NOTION_TOKEN || !env.NOTION_APPLICATIONS_DB) return null; // desktop app without Notion
  const query = (filter) => notion(env, `databases/${env.NOTION_APPLICATIONS_DB}/query`, 'POST', { filter, page_size: 5 });
  const exact = await query({ property: 'Job URL', url: { equals: url } });
  if (exact.results.length) return exact.results[0];
  const key = jobKey(url);
  if (!key) return null;
  const loose = await query({ property: 'Job URL', url: { contains: key } });
  return loose.results[0] || null;
}

async function children(env, id) {
  const blocks = [];
  let cursor;
  do {
    const page = await notion(env, `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    blocks.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return blocks;
}

// The kit JSON sits in a code block inside the "📝 Application kit" toggle heading (src/ai/kit.py).
async function readKit(env, pageId) {
  const heading = (await children(env, pageId)).find((b) => plain(b[b.type]?.rich_text).startsWith(KIT_HEADING));
  if (!heading) return null;
  const code = (await children(env, heading.id)).find((b) => b.type === 'code');
  if (!code) return null;
  try { return JSON.parse(plain(code.code.rich_text)); } catch { return null; }
}

// Readable text of a Notion page (paragraphs, headings, lists, toggles, tables), two levels deep.
export async function pageText(env, pageId, depth = 0) {
  const lines = [];
  for (const block of await children(env, pageId)) {
    const body = block[block.type] || {};
    if (block.type === 'table_row') lines.push(body.cells.map(plain).join(' | '));
    else if (body.rich_text) lines.push(plain(body.rich_text));
    if (block.has_children && depth < 2 && !['child_page', 'child_database'].includes(block.type)) {
      lines.push(await pageText(env, block.id, depth + 1));
    }
  }
  return lines.filter(Boolean).join('\n');
}

// Which Anthropic key pays for this call. Today the owner's; later a customer's own key
// ("bring your own key"), stored encrypted in Cloudflare KV, looked up here.
export function anthropicKey(env) {
  return env.ANTHROPIC_API_KEY;
}

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['eligible', 'eligibility_note', 'answers'],
  properties: {
    eligible: { type: 'boolean' },
    eligibility_note: { type: 'string' },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value', 'confidence', 'note', 'category', 'use'],
        properties: {
          field: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: 'string' },
          category: { type: 'string', enum: ['knockout', 'legal', 'demographic', 'contact', 'normal'] },
          use: { type: 'string', enum: ['fill', 'propose'] },
        },
      },
    },
  },
};

const INSTRUCTIONS = `You fill in a job application form for the applicant described in <profile> and <standard_answers>.
The applicant reviews every answer and clicks Submit themselves.

For each form field you are given its id, label, type, whether it is required, and its options if it has any. Return one answer per field you can answer:
- text / textarea: the text to type. Write open questions in the applicant's own voice, following the cover-letter style in <standard_answers>. Use the drafted kit answers when one fits the question.
- select, radio: exactly one of the listed options, copied character for character.
- combobox: its options are often not listed (the menu is closed); give the option wording the form most likely uses ("Yes", "No", a country or city name). When options are listed, copy one exactly.
- checkbox: "checked" or "unchecked".
use: "fill" when <profile>, <standard_answers> or the drafted kit state the answer: it is typed into the form. When they don't state it, still give your most plausible answer for this applicant and this job, with use: "propose": the applicant sees it as a suggestion and confirms it; it is never typed for them. Base it on what is stated (their country, their CV, that they chose to apply to this job) and on what the posting expects (its hours, place, duties). Leave a field out (no answer) when nothing given points to an answer: never invent employers, dates, numbers, links or personal details. Leave out legal consents and acknowledgements, and never propose an answer to a demographic question or to a fact only the applicant can know (a criminal record, a registration with an office, their health). Voluntary demographic questions (gender, ethnicity, veteran, disability) are answered only from <standard_answers>; otherwise choose the "decline to answer" option if there is one.
category, in whatever language the form is: knockout = a question the employer can reject on by itself (work authorisation, visa or sponsorship, location, relocation, on-site days, a required licence or language); legal = a consent, terms, privacy notice, certification or acknowledgement; demographic = gender, ethnicity, disability, veteran or similar voluntary questions; contact = name, email, phone, address; normal = anything else.
confidence: high when the answer is stated in the profile or standard answers, medium when you inferred it, low when the applicant should check it. note: a few words on why, for medium and low.

Eligibility: set eligible to false only when the posting clearly rules the applicant out (a work location, residence or authorization the profile says they can't meet, or a required language they don't speak), and say why in eligibility_note. Otherwise eligible is true and eligibility_note is empty.`;

// test: the user is testing the filling (Settings → Test mode): invent plausible values for anything unknown.
export const TEST_MODE = 'TEST MODE: this is a test of the form filling, not a real application. Answer EVERY field; where the profile or standard answers do not say, invent a plausible dummy value (for select fields pick the most plausible listed option). Never leave a field empty, set confidence to low and use to "fill" for invented values, and set eligible to true.';

export async function answerForm(env, { url, fields, page_text, test = false }, client = null) {
  const startedAt = Date.now();
  const row = await findRow(env, url).catch(() => null);
  const kit = row ? await readKit(env, row.id).catch(() => null) : null;
  // The desktop app passes the local Profile and standard answers; the Worker reads them from Notion.
  const [profile, standard] = await Promise.all([
    env.PROFILE_TEXT ?? pageText(env, env.NOTION_PROFILE_PAGE_ID),
    env.ANSWERS_TEXT ?? (env.NOTION_ANSWERS_PAGE_ID ? pageText(env, env.NOTION_ANSWERS_PAGE_ID) : ''),
  ]).then(async ([p, a]) => {
    // What earlier fills learned about forms (🧠 Form knowledge), as extra standard answers.
    const known = env.KNOWLEDGE_TEXT ?? (env.NOTION_KNOWLEDGE_PAGE ? await pageText(env, env.NOTION_KNOWLEDGE_PAGE).catch(() => '') : '');
    return [p, known ? `${a}\n\n# Learned from earlier forms\n${known}` : a];
  });
  const job = row ? summary(row) : { title: '', company: '', url };
  const anthropic = client || new Anthropic({ apiKey: anthropicKey(env), fetch: (...args) => globalThis.fetch(...args) });
  const response = await anthropic.messages.create({
    model: env.JOB_PILOTTO_KIT_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    // The profile and standard answers are the same for every form: cached, so a multi-page form
    // or the next application within five minutes pays a tenth for them.
    system: [
      { type: 'text', text: test ? `${INSTRUCTIONS}\n\n${TEST_MODE}` : INSTRUCTIONS },
      { type: 'text', text: `<profile>\n${profile}\n</profile>\n<standard_answers>\n${standard}\n</standard_answers>`,
        cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role: 'user',
      content: [
        `<job>\n${job.title} at ${job.company}\n${url}\n${String(page_text || '').slice(0, 12000)}\n</job>`,
        kit ? `<drafted_kit>\n${JSON.stringify({ answers: kit.answers, cover_letter: kit.cover_letter })}\n</drafted_kit>` : '',
        `<form_fields>\n${JSON.stringify(fields)}\n</form_fields>`,
      ].filter(Boolean).join('\n\n'),
    }],
    output_config: { format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to answer this form');
  const text = response.content.find((block) => block.type === 'text')?.text;
  const result = JSON.parse(text);
  const usage = response.usage || {};
  // Answered on the user's Claude plan (Claude Code): no per-token cost.
  const usd = usage.billing === 'subscription' ? 0 : ((usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output
    + (usage.cache_read_input_tokens || 0) * PRICE.cacheRead + (usage.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;
  const known = new Set(fields.map((f) => f.field));
  // A proposal is never for a legal, demographic or knockout question, whatever the AI said (a hard floor beside its own rule): a wrong
  // guess there can reject the applicant, and only they can say. Proposals are shown in the app, never typed (extension/flow.js).
  const raw = (Array.isArray(result.answers) ? result.answers : []).filter((a) => a.use !== 'propose' || !['legal', 'demographic', 'knockout'].includes(a.category));
  // What this call did, in counts and field ids (never an answer or the profile's text): with 0 answers it tells "nothing to go on"
  // (an empty profile) from "answered, but under other ids" from "answered nothing" (8 Oct 2026: Coop, 11 fields sent, 0 back, no trace).
  await env.onAnswer?.({ fields: fields.length, returned: raw.length, kept: raw.filter((a) => known.has(a.field) && a.value !== '').length,
    unknownIds: raw.filter((a) => !known.has(a.field)).map((a) => String(a.field).slice(0, 60)).slice(0, 10),
    empty: raw.filter((a) => known.has(a.field) && a.value === '').length, profileChars: String(profile || '').length,
    answersChars: String(standard || '').length, kit: !!kit, stop: response.stop_reason || '', ms: Date.now() - startedAt,
    proposed: raw.filter((a) => known.has(a.field) && a.value !== '' && a.use === 'propose').length });
  return {
    job: row ? summary(row) : null,
    eligible: result.eligible, eligibility_note: result.eligibility_note,
    answers: raw.filter((a) => known.has(a.field) && a.value !== ''),
    cover_letter: kit?.cover_letter || '',
    usd: Math.round(usd * 10000) / 10000,
  };
}

const ATS = [['greenhouse', 'Greenhouse'], ['ashbyhq', 'Ashby'], ['lever.co', 'Lever'], ['workable', 'Workable']];

// Lessons from a fill, from its field log (no AI): what kept fields from being filled, grouped.
export function learnings(run) {
  const left = (run.trace || []).filter((f) => f.outcome !== 'filled');
  const groups = {};
  for (const f of left) (groups[f.reason || 'unknown'] ||= []).push(f.label);
  return Object.entries(groups).map(([reason, labels]) => `${labels.length} left: ${reason} (${labels.slice(0, 4).join(', ')}${labels.length > 4 ? ', …' : ''})`);
}

// The run's page: summary, the field-by-field log as a table, and what's left for the user.
function runBlocks(run, minutes) {
  const t = (s) => [{ type: 'text', text: { content: String(s ?? '').slice(0, 1900) } }];
  const p = (s) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: t(s) } });
  const h = (s) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: t(s) } });
  const li = (s) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: t(s) } });
  const trace = (run.trace || []).slice(0, 90);
  const blocks = [p(`${run.kit ? 'Filled from the kit' : 'Claude answered the form on the page'} in ${minutes} min; ` +
    `${trace.filter((f) => f.outcome === 'filled').length} of ${trace.length} fields filled; AI cost $${Number(run.usd || 0).toFixed(3)}.`)];
  if (trace.length) {
    blocks.push(h('Field by field'));
    const cells = (...values) => ({ type: 'table_row', table_row: { cells: values.map(t) } });
    blocks.push({ object: 'block', type: 'table', table: { table_width: 5, has_column_header: true, children: [
      cells('Field', 'Required', 'Answer from', 'Result', 'Why / note'),
      ...trace.map((f) => cells(f.label, f.required ? 'yes' : '', f.source || '—', f.outcome === 'filled' ? '✅ filled' : '⬜ left',
        [f.reason, f.low && `check: ${f.low}`].filter(Boolean).join(' · '))),
    ] } });
  }
  const lessons = learnings(run);
  if (lessons.length) { blocks.push(h('Learnings')); blocks.push(...lessons.map(li)); }
  if ((run.todo || []).length) { blocks.push(h('Left for you')); blocks.push(...run.todo.map(li)); }
  if (run.debug) {
    // The full record (step timings, the form as read, every answer and its source, dropdown clicks, errors).
    const json = JSON.stringify(run.debug, null, 1).slice(0, 190000);
    const chunks = [];
    for (let i = 0; i < json.length; i += 1900) chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
    blocks.push(h('Debug data'));
    for (let i = 0; i < chunks.length; i += 100) {
      blocks.push({ object: 'block', type: 'code', code: { language: 'json', rich_text: chunks.slice(i, i + 100) } });
    }
  }
  return blocks;
}

// A form fill by the extension, as a row in 🎏 Job Apply — Agent Runs (same columns as the agent runs).
export async function logRun(env, run) {
  const row = await findRow(env, run.url).catch(() => null);
  const job = row ? summary(row) : { title: '', company: '' };
  const host = (() => { try { return new URL(run.url).hostname; } catch { return ''; } })();
  const minutes = Math.round((Date.parse(run.ended) - Date.parse(run.started)) / 600) / 100;
  const text = (value) => ({ rich_text: [{ text: { content: String(value).slice(0, 1900) } }] });
  const properties = {
    Run: { title: [{ text: { content: `${job.company || host} · ${job.title || 'form'} · Extension` } }] },
    Agent: { select: { name: 'Extension' } },
    ATS: { select: { name: (ATS.find(([key]) => host.includes(key)) || [null, 'Other'])[1] } },
    Status: { select: { name: run.unfilled ? 'Needs input' : 'Ready' } },
    Started: { date: { start: run.started } }, Ended: { date: { start: run.ended } },
    Minutes: { number: minutes }, Fields: { number: Number(run.fields) || 0 },
    'Unfilled required': { number: Number(run.unfilled) || 0 },
    'Tokens (total)': { number: 0 },
    'Job URL': { url: run.url },
    'Billed to': { select: { name: run.usd ? 'Anthropic API credits' : 'Unknown' } },
    Reason: text(`${run.kit ? 'Filled from the kit' : 'Claude answered the form'}; AI cost $${Number(run.usd || 0).toFixed(3)}`),
    Learnings: text(learnings(run).join(' · ') || (run.todo || []).join(' · ')),
    ...(row ? { Job: { relation: [{ id: row.id }] } } : {}),
  };
  const page = await notion(env, 'pages', 'POST', { parent: { database_id: env.NOTION_AGENT_RUNS_DB }, properties,
    children: runBlocks(run, minutes) });
  return { ok: true, url: page.url };
}

function summary(row) {
  const props = row.properties;
  return {
    title: plain(props.Job?.title), company: plain(props.Company?.rich_text),
    stage: props.Stage?.select?.name || '', url: props['Job URL']?.url || '', notion_url: row.url,
  };
}

// Only what filling a form needs: never the job analysis or the JSON's other internals.
function kitForForm(kit) {
  return {
    answers: (kit.answers || []).filter((a) => a.field).map(({ field, question, answer, needs_review, category }) =>
      ({ field, question, answer, needs_review: !!needs_review, category: category || '' })),
    cover_letter: kit.cover_letter || '',
    check_before_sending: kit.check_before_sending || [],
  };
}

export async function handleExtension(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(token, env.EXTENSION_TOKEN)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/extension/kit') {
      const job = url.searchParams.get('url');
      if (!job) return json({ error: 'url is required' }, 400);
      const row = await findRow(env, job);
      if (!row && env.localJob) {
        const local = await env.localJob(job);
        if (local) return json({ job: local, kit: null });
      }
      if (!row) return json({ error: 'not tracked', hint: 'Prepare a kit for this job first (📝 Prepare in Telegram).' }, 404);
      const kit = await readKit(env, row.id);
      return json({ job: summary(row), kit: kit ? kitForForm(kit) : null });
    }
    if (request.method === 'POST' && url.pathname === '/extension/answer') {
      const body = await request.json().catch(() => ({}));
      if (!body.url || !Array.isArray(body.fields) || !body.fields.length) return json({ error: 'url and fields are required' }, 400);
      // The desktop app can answer with the user's own Claude Code (env.aiClient); the Worker needs its key.
      const aiClient = env.aiClient || null;
      if (!aiClient && !anthropicKey(env)) return json({ error: 'AI is not set up on this Worker (ANTHROPIC_API_KEY)' }, 503);
      const fields = body.fields.slice(0, 80).map((f) => ({
        field: String(f.field || '').slice(0, 200), label: String(f.label || '').slice(0, 300),
        type: String(f.type || '').slice(0, 30), required: !!f.required,
        ...(Array.isArray(f.options) && f.options.length ? { options: f.options.slice(0, 60).map((o) => String(o).slice(0, 150)) } : {}),
      }));
      try {
        return json(await answerForm(env, { url: body.url, fields, page_text: body.page_text, test: !!body.test }, aiClient));
      } catch (error) {
        const limit = /credit|spend|limit|billing/i.test(error.message);
        return json({ error: limit ? 'The Anthropic spend limit is reached; fill without AI for now.' : `AI answer failed: ${error.message}` }, limit ? 402 : 502);
      }
    }
    if (request.method === 'POST' && url.pathname === '/extension/run') {
      const run = await request.json().catch(() => ({}));
      await env.onRun?.(run);  // desktop app: collects the questions nothing could answer
      if (!run.url || !env.NOTION_TOKEN || !env.NOTION_AGENT_RUNS_DB) return json({ ok: false, skipped: true });
      return json(await logRun(env, run).catch((error) => ({ ok: false, error: error.message })));
    }
    if (request.method === 'POST' && url.pathname === '/extension/log') {
      // The extension's own decisions, pushed as they happen (and re-pushed after a crashed worker). Cleaned here, at
      // the boundary: counts and ids, never a form answer or a message body (lib/log.js's rule, enforced on the way
      // in). The desktop app writes them to logs/app.log; a Cloudflare Worker prints them.
      const { entries } = await request.json().catch(() => ({}));
      const clean = (Array.isArray(entries) ? entries : []).slice(-50).map((entry) => ({
        at: typeof entry?.at === 'string' ? entry.at.slice(0, 30) : '',
        kind: String(entry?.kind || 'note').slice(0, 24),
        text: String(entry?.text || '').slice(0, 300),
        fields: Object.fromEntries(Object.entries(entry?.fields && typeof entry.fields === 'object' ? entry.fields : {})
          .slice(0, 8).map(([key, value]) => [String(key).slice(0, 24),
            key === 'fields' && Array.isArray(value) ? fieldRows(value)
              : typeof value === 'string' ? value.slice(0, 60) : typeof value === 'number' || typeof value === 'boolean' ? value : ''])),
      }));
      if (env.onLog) await env.onLog(clean);
      else console.log(`extension log: ${clean.map((entry) => `${entry.kind}: ${entry.text}`).join(' | ')}`);
      return json({ ok: true, kept: clean.length });
    }
    if (request.method === 'POST' && url.pathname === '/extension/applied') {
      const { url: job, why, evidence } = await request.json().catch(() => ({}));
      if (!job || !/^https?:\/\//.test(job)) return json({ error: 'url is required' }, 400);
      // What decided this, and on what evidence. The extension sends it (background.js checkSubmitted); it goes to
      // the app's log with markApplied, or to this Worker's log when it dispatches the run instead (1 Oct 2026: a
      // job was marked Applied while its form sat open, unsubmitted, and nothing recorded why).
      const decision = `applied ${why || 'no reason given'} (${evidence?.path || 'unknown'}${evidence?.host ? ` on ${evidence.host}` : ''}, extension ${evidence?.version || '?'})`;
      if (env.markApplied) return json(await env.markApplied(job, decision)); // desktop app: recorded locally
      console.log(`extension ${decision} -> ${job}`);
      const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
          'User-Agent': 'sre-job-pilotto-bot', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { mode: 'apply', job, action: 'applied' } }),
      });
      if (response.status !== 204) return json({ error: `GitHub dispatch failed: ${response.status}` }, 502);
      return json({ ok: true, message: 'Marking it Applied; Telegram confirms in about a minute.' });
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}

// A fill's per-field outcomes (extension/background.js "fields: …"): the one list the log boundary lets through, row by row and only these
// keys, each a short string: the form's wording and kinds, never an answer (8 Oct 2026: "what happened to this field?" needed page probes).
function fieldRows(rows) {
  const keep = {label: 50, type: 16, outcome: 12, source: 30, reason: 80};
  return rows.slice(0, 40).filter(row => row && typeof row === 'object')
    .map(row => Object.fromEntries(Object.entries(keep).map(([key, max]) => [key, typeof row[key] === 'string' ? row[key].slice(0, max) : ''])));
}

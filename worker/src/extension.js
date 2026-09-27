// Endpoints for the Job Pilotto Chrome extension (extension/ in the repo).
//
//   GET  /extension/kit?url=<job page>  the job's Applications row and its drafted kit, read from Notion
//   GET  /extension/queue               jobs with a drafted kit, for the popup's "Ready to apply" list
//   POST /extension/answer {url, fields, page_text}
//                                       one Claude call answers every field of the live form from the
//                                       Profile, Application Answers and the kit; checks eligibility
//   POST /extension/applied {url}       mark the job Applied (the daily workflow's apply mode, by URL)
//
// Every call needs `Authorization: Bearer <EXTENSION_TOKEN>` (a Worker secret). Responses allow any
// origin, so the extension needs no host permission for the Worker; the token is the access control.

import Anthropic from '@anthropic-ai/sdk';

const KIT_HEADING = '📝 Application kit';
const DEFAULT_MODEL = 'claude-sonnet-5';
// USD per million tokens, for the cost shown to the user and logged (claude-sonnet-5).
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
async function pageText(env, pageId, depth = 0) {
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
        required: ['field', 'value', 'confidence', 'note'],
        properties: {
          field: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: 'string' },
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
Leave out a field (no answer) when the profile and standard answers don't give you the fact: never invent employers, dates, numbers, links or personal details. Leave out legal consents and acknowledgements. Voluntary demographic questions (gender, ethnicity, veteran, disability) are answered only from <standard_answers>; otherwise choose the "decline to answer" option if there is one.
confidence: high when the answer is stated in the profile or standard answers, medium when you inferred it, low when the applicant should check it. note: a few words on why, for medium and low.

Eligibility: set eligible to false only when the posting clearly rules the applicant out (a work location, residence or authorization the profile says they can't meet, or a required language they don't speak), and say why in eligibility_note. Otherwise eligible is true and eligibility_note is empty.`;

export async function answerForm(env, { url, fields, page_text }, client = null) {
  const row = await findRow(env, url).catch(() => null);
  const kit = row ? await readKit(env, row.id).catch(() => null) : null;
  // The desktop app passes the local Profile and standard answers; the Worker reads them from Notion.
  const [profile, standard] = await Promise.all([
    env.PROFILE_TEXT ?? pageText(env, env.NOTION_PROFILE_PAGE_ID),
    env.ANSWERS_TEXT ?? (env.NOTION_ANSWERS_PAGE_ID ? pageText(env, env.NOTION_ANSWERS_PAGE_ID) : ''),
  ]);
  const job = row ? summary(row) : { title: '', company: '', url };
  const anthropic = client || new Anthropic({ apiKey: anthropicKey(env), fetch: (...args) => globalThis.fetch(...args) });
  const response = await anthropic.messages.create({
    model: env.JOB_PILOTTO_KIT_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    // The profile and standard answers are the same for every form: cached, so a multi-page form
    // or the next application within five minutes pays a tenth for them.
    system: [
      { type: 'text', text: INSTRUCTIONS },
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
  const usd = ((usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output
    + (usage.cache_read_input_tokens || 0) * PRICE.cacheRead + (usage.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;
  const known = new Set(fields.map((f) => f.field));
  return {
    job: row ? summary(row) : null,
    eligible: result.eligible, eligibility_note: result.eligibility_note,
    answers: result.answers.filter((a) => known.has(a.field) && a.value !== ''),
    cover_letter: kit?.cover_letter || '',
    usd: Math.round(usd * 10000) / 10000,
  };
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
    answers: (kit.answers || []).filter((a) => a.field).map(({ field, question, answer, needs_review }) =>
      ({ field, question, answer, needs_review: !!needs_review })),
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
    if (request.method === 'GET' && url.pathname === '/extension/queue') {
      if (env.queue) return json({ jobs: await env.queue() }); // desktop app: its own list
      const data = await notion(env, `databases/${env.NOTION_APPLICATIONS_DB}/query`, 'POST', {
        filter: { property: 'Stage', select: { equals: 'Kit ready' } },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }], page_size: 25,
      });
      return json({ jobs: data.results.map(summary).filter((job) => job.url) });
    }
    if (request.method === 'POST' && url.pathname === '/extension/answer') {
      const body = await request.json().catch(() => ({}));
      if (!body.url || !Array.isArray(body.fields) || !body.fields.length) return json({ error: 'url and fields are required' }, 400);
      if (!anthropicKey(env)) return json({ error: 'AI is not set up on this Worker (ANTHROPIC_API_KEY)' }, 503);
      const fields = body.fields.slice(0, 80).map((f) => ({
        field: String(f.field || '').slice(0, 200), label: String(f.label || '').slice(0, 300),
        type: String(f.type || '').slice(0, 30), required: !!f.required,
        ...(Array.isArray(f.options) && f.options.length ? { options: f.options.slice(0, 60).map((o) => String(o).slice(0, 150)) } : {}),
      }));
      try {
        return json(await answerForm(env, { url: body.url, fields, page_text: body.page_text }));
      } catch (error) {
        const limit = /credit|spend|limit|billing/i.test(error.message);
        return json({ error: limit ? 'The Anthropic spend limit is reached; fill without AI for now.' : `AI answer failed: ${error.message}` }, limit ? 402 : 502);
      }
    }
    if (request.method === 'POST' && url.pathname === '/extension/applied') {
      const { url: job } = await request.json().catch(() => ({}));
      if (!job || !/^https?:\/\//.test(job)) return json({ error: 'url is required' }, 400);
      if (env.markApplied) return json(await env.markApplied(job)); // desktop app: recorded locally
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

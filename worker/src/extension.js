// Endpoints for the Job Pilotto Chrome extension (extension/ in the repo).
//
//   GET  /extension/kit?url=<job page>  the job's Applications row and its drafted kit, read from Notion
//   POST /extension/applied {url}       mark the job Applied (the daily workflow's apply mode, by URL)
//
// Every call needs `Authorization: Bearer <EXTENSION_TOKEN>` (a Worker secret). Responses allow any
// origin, so the extension needs no host permission for the Worker; the token is the access control.

const KIT_HEADING = '📝 Application kit';
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
      if (!row) return json({ error: 'not tracked', hint: 'Prepare a kit for this job first (📝 Prepare in Telegram).' }, 404);
      const kit = await readKit(env, row.id);
      return json({ job: summary(row), kit: kit ? kitForForm(kit) : null });
    }
    if (request.method === 'POST' && url.pathname === '/extension/applied') {
      const { url: job } = await request.json().catch(() => ({}));
      if (!job || !/^https?:\/\//.test(job)) return json({ error: 'url is required' }, 400);
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

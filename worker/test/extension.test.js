import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';
import { jobKey } from '../src/extension.js';

const env = {
  NOTION_TOKEN: 'nt', NOTION_APPLICATIONS_DB: 'db1', GITHUB_TOKEN: 'gh', GITHUB_REPO: 'owner/repo',
  WORKFLOW_FILE: 'daily.yml', EXTENSION_TOKEN: 'ext-secret',
};
const JOB = 'https://job-boards.greenhouse.io/anthropic/jobs/4468036';
const row = {
  id: 'page1', url: 'https://www.notion.so/page1',
  properties: {
    Job: { title: [{ plain_text: 'Staff SRE' }] }, Company: { rich_text: [{ plain_text: 'Anthropic' }] },
    Stage: { select: { name: 'Kit ready' } }, 'Job URL': { url: JOB },
  },
};
const kit = {
  version: 3, url: JOB, model: 'claude-sonnet-5', cover_letter: 'Dear team', check_before_sending: ['Salary'],
  answers: [{ field: 'question_1', question: 'Why us?', answer: 'Because', needs_review: false },
            { field: '', question: 'Not a form field', answer: 'x', needs_review: false }],
  analysis: { private: 'not for the extension' },
};

// Replace fetch with a recorder; answer Notion and GitHub by URL.
function mockFetch({ exact = [row], loose = [], withKit = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: init.headers });
    const reply = (json, status = 200) => new Response(status === 204 ? null : JSON.stringify(json), { status });
    if (url.includes('/databases/db1/query')) return reply({ results: !body.filter.url ? exact : body.filter.url.equals ? exact : loose });
    if (url.includes('/blocks/page1/children')) {
      return reply({ results: [
        { id: 'h0', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Notes' }] } },
        ...(withKit ? [{ id: 'h1', type: 'heading_3', heading_3: { rich_text: [{ plain_text: '📝 Application kit (26 Sep)' }] } }] : []),
      ], has_more: false });
    }
    if (url.includes('/blocks/h1/children')) {
      return reply({ results: [{ id: 'c1', type: 'code', code: { rich_text: [{ plain_text: JSON.stringify(kit) }] } }], has_more: false });
    }
    if (url.includes('/dispatches')) return reply(null, 204);
    return reply({ error: 'unexpected' }, 500);
  };
  return calls;
}

const call = (path, { token = 'ext-secret', method = 'GET', body } = {}) => worker.fetch(new Request(`https://bot.test${path}`, {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}),
}), env, { waitUntil() {} });

test('extension calls need the token', async () => {
  mockFetch();
  assert.equal((await call(`/extension/kit?url=${encodeURIComponent(JOB)}`, { token: 'wrong' })).status, 401);
  assert.equal((await call(`/extension/kit?url=${encodeURIComponent(JOB)}`, { token: '' })).status, 401);
  const preflight = await worker.fetch(new Request('https://bot.test/extension/kit', { method: 'OPTIONS' }), env, {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
});

test('kit for a job page: only what filling the form needs', async () => {
  mockFetch();
  const response = await call(`/extension/kit?url=${encodeURIComponent(JOB)}`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.job, { title: 'Staff SRE', company: 'Anthropic', stage: 'Kit ready', url: JOB, notion_url: 'https://www.notion.so/page1' });
  assert.deepEqual(data.kit.answers, [{ field: 'question_1', question: 'Why us?', answer: 'Because', needs_review: false }]);
  assert.equal(data.kit.cover_letter, 'Dear team');
  assert.equal(JSON.stringify(data).includes('not for the extension'), false);
});

test('a tracking-parameter or alternate link still finds the job by its id', async () => {
  const calls = mockFetch({ exact: [], loose: [row] });
  const data = await (await call(`/extension/kit?url=${encodeURIComponent('https://job-boards.greenhouse.io/embed/job_app?for=anthropic&token=4468036')}`)).json();
  assert.equal(data.job.title, 'Staff SRE');
  assert.equal(calls.filter((c) => c.url.includes('/query'))[1].body.filter.url.contains, '4468036');
});

test('untracked job and job without a kit', async () => {
  mockFetch({ exact: [], loose: [] });
  assert.equal((await call(`/extension/kit?url=${encodeURIComponent('https://example.com/careers/1')}`)).status, 404);
  mockFetch({ withKit: false });
  const data = await (await call(`/extension/kit?url=${encodeURIComponent(JOB)}`)).json();
  assert.equal(data.kit, null);
});

test('mark applied dispatches the apply workflow by URL', async () => {
  const calls = mockFetch();
  const response = await call('/extension/applied', { method: 'POST', body: { url: JOB } });
  assert.equal(response.status, 200);
  const dispatch = calls.find((c) => c.url.includes('/dispatches'));
  assert.deepEqual(dispatch.body, { ref: 'main', inputs: { mode: 'apply', job: JOB, action: 'applied' } });
  assert.equal((await call('/extension/applied', { method: 'POST', body: { url: 'javascript:alert(1)' } })).status, 400);
});

test('job keys for Greenhouse, Lever and Ashby links', () => {
  assert.equal(jobKey('https://boards.greenhouse.io/grafanalabs/jobs/6103685004?gh_src=x'), '6103685004');
  assert.equal(jobKey('https://jobs.lever.co/palantir/0a1b2c3d-1111-2222-3333-444455556666/apply'), '0a1b2c3d-1111-2222-3333-444455556666');
  assert.equal(jobKey('https://jobs.ashbyhq.com/openai/b2250643-bfd0-4ce6-abbf-cb7e8c8123ba/application'), 'b2250643-bfd0-4ce6-abbf-cb7e8c8123ba');
  assert.equal(jobKey('https://example.com/careers/1'), null);
});

test('the Telegram webhook is unchanged', async () => {
  mockFetch();
  assert.equal((await worker.fetch(new Request('https://bot.test/telegram', { method: 'POST' }), env, {})).status, 403);
});

test('AI answers: profile and answers from Notion, one Claude call, only known fields back', async () => {
  const { answerForm } = await import('../src/extension.js');
  mockFetch();
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/blocks/prof/children')) {
      return new Response(JSON.stringify({ results: [{ id: 'p1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'SRE, B permit' }] } }], has_more: false }));
    }
    if (String(url).includes('/blocks/ans/children')) {
      return new Response(JSON.stringify({ results: [{ id: 'a1', type: 'table_row', table_row: { cells: [[{ plain_text: 'Notice' }], [{ plain_text: '1 month' }]] } }], has_more: false }));
    }
    return base(url, init);
  };
  const seen = [];
  const client = { messages: { create: async (request) => {
    seen.push(request);
    return {
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [
        { field: 'q1', value: '1 month', confidence: 'high', note: '' },
        { field: 'invented', value: 'x', confidence: 'low', note: '' },
        { field: 'q2', value: '', confidence: 'low', note: '' }] }) }],
    };
  } } };
  const result = await answerForm({ ...env, NOTION_PROFILE_PAGE_ID: 'prof', NOTION_ANSWERS_PAGE_ID: 'ans' },
    { url: JOB, fields: [{ field: 'q1', label: 'Notice period', type: 'text' }, { field: 'q2', label: 'Other', type: 'text' }], page_text: 'About the role' }, client);
  assert.deepEqual(result.answers.map((a) => a.field), ['q1']);
  assert.equal(result.eligible, true);
  assert.equal(result.cover_letter, 'Dear team');
  assert.equal(result.usd, 0.004);
  const request = seen[0];
  assert.equal(request.model, 'claude-sonnet-5');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.match(request.system[1].text, /SRE, B permit/);
  assert.match(request.system[1].text, /Notice \| 1 month/);
  assert.deepEqual(request.system[1].cache_control, { type: 'ephemeral' });
  assert.match(request.messages[0].content, /drafted_kit/);
});

test('AI answer endpoint: validates input and reports a missing key', async () => {
  mockFetch();
  assert.equal((await call('/extension/answer', { method: 'POST', body: { url: JOB } })).status, 400);
  const response = await call('/extension/answer', { method: 'POST', body: { url: JOB, fields: [{ field: 'q1' }] } });
  assert.equal(response.status, 503);
});

test('ready-to-apply queue lists Kit ready jobs', async () => {
  const calls = mockFetch();
  const data = await (await call('/extension/queue')).json();
  assert.deepEqual(data.jobs.map((j) => j.company), ['Anthropic']);
  assert.deepEqual(calls[0].body.filter, { property: 'Stage', select: { equals: 'Kit ready' } });
});

test('test mode tells Claude to answer every field with dummy values where unsure', async () => {
  const { answerForm, TEST_MODE } = await import('../src/extension.js');
  const seen = [];
  const client = { messages: { create: async (request) => {
    seen.push(request);
    return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [] }) }] };
  } } };
  const env = { PROFILE_TEXT: 'SRE', ANSWERS_TEXT: '', ANTHROPIC_API_KEY: 'x', findRow: null };
  await answerForm(env, { url: 'https://jobs.lever.co/acme/1', fields: [{ field: 'q', label: 'Q', type: 'text' }], page_text: '', test: true }, client).catch(() => {});
  await answerForm(env, { url: 'https://jobs.lever.co/acme/1', fields: [{ field: 'q', label: 'Q', type: 'text' }], page_text: '' }, client).catch(() => {});
  assert.ok(seen[0].system[0].text.includes(TEST_MODE));
  assert.ok(!seen[1].system[0].text.includes(TEST_MODE));
});

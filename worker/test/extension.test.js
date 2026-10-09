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
  version: 3, url: JOB, model: 'claude-sonnet-5-5', cover_letter: 'Dear team', check_before_sending: ['Salary'],
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

const call = (path, { token = 'ext-secret', method = 'GET', body } = {}, extra = {}) => worker.fetch(new Request(`https://bot.test${path}`, {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}),
}), {...env, ...extra}, { waitUntil() {} });

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
  assert.deepEqual(data.kit.answers, [{ field: 'question_1', question: 'Why us?', answer: 'Because', needs_review: false, category: '' }]);
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

// The decisions the extension made used to die with its worker. They are pushed here instead, cleaned at the
// boundary (counts, ids, reasons — never a form answer or a page's text) and handed to the app's log.
test("the extension's decisions reach the app, cleaned and bounded", async () => {
  const seen = [];
  const response = await call('/extension/log', { method: 'POST', body: { entries: [
    { at: '2026-10-01T08:00:00.000Z', kind: 'submitted?', text: 'looks like a confirmation URL, but no submit press was seen: not marked',
      fields: { job: JOB, url: 'https://x.test/a', version: '0.8.26' } },
    { kind: 'fill', text: 'x'.repeat(400), fields: { big: 'y'.repeat(400), [('k').repeat(60)]: 1, nested: {a: 1}, n: 2, ok: true } },
  ] } }, { onLog: async entries => seen.push(...entries) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).kept, 2);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].kind, 'submitted?');
  assert.equal(seen[0].fields.job, JOB);
  assert.equal(seen[1].text.length, 300);                 // truncated, not stored whole
  assert.equal(seen[1].fields.big.length, 60);
  assert.equal(seen[1].fields[('k').repeat(60)], undefined); // a property name is bounded too
  assert.equal(seen[1].fields.nested, '');                 // only scalars survive
  assert.equal(seen[1].fields.ok, true);
  // Without an app (a Cloudflare Worker), nothing is lost: the same entries are printed to its log.
  const many = Array.from({length: 80}, (_, i) => ({kind: 'fill', text: `fill ${i}`}));
  assert.equal((await (await call('/extension/log', { method: 'POST', body: { entries: many } })).json()).kept, 50);
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
  const traces = [];
  const result = await answerForm({ ...env, NOTION_PROFILE_PAGE_ID: 'prof', NOTION_ANSWERS_PAGE_ID: 'ans', onAnswer: (trace) => traces.push(trace) },
    { url: JOB, fields: [{ field: 'q1', label: 'Notice period', type: 'text' }, { field: 'q2', label: 'Other', type: 'text' }], page_text: 'About the role' }, client);
  assert.deepEqual(result.answers.map((a) => a.field), ['q1']);
  // The log line: why answers were dropped, in counts and ids, never an answer or the profile's text (8 Oct 2026: Coop got 0 back, untraceable).
  const { ms, engine, provider, billing, model, ...trace } = traces[0];
  assert.deepEqual([engine, provider], ['api', 'anthropic']);   // a client with no .engine is the raw Anthropic SDK
  assert.deepEqual(trace, { fields: 2, returned: 3, kept: 1, unknownIds: ['invented'], empty: 1, profileChars: 13, answersChars: trace.answersChars, kit: true, stop: 'end_turn', proposed: 0 });
  assert.ok(trace.answersChars > 0 && Number.isInteger(ms));
  assert.ok(!JSON.stringify(traces).includes('1 month') && !JSON.stringify(traces).includes('B permit'));
  assert.equal(result.eligible, true);
  assert.equal(result.cover_letter, 'Dear team');
  assert.equal(result.usd, 0.004);
  const request = seen[0];
  assert.equal(request.model, 'claude-sonnet-5-5');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.match(request.system[1].text, /SRE, B permit/);
  assert.match(request.system[1].text, /Notice \| 1 month/);
  assert.deepEqual(request.system[1].cache_control, { type: 'ephemeral' });
  assert.match(request.messages[0].content, /drafted_kit/);
});

test('AI answer endpoint: the desktop app\'s Claude Code client answers without an API key (no cost)', async () => {
  const { default: worker } = await import('../src/index.js');
  mockFetch();
  const seen = [];
  const aiClient = { messages: { create: async (request) => {
    seen.push(request);
    return { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 90, billing: 'subscription' },
      content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [{ field: 'q1', value: 'yes', confidence: 'high', note: '' }] }) }] };
  } } };
  const noKey = { ...env, ANTHROPIC_API_KEY: '', aiClient, PROFILE_TEXT: 'SRE', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' };
  const response = await worker.fetch(new Request('https://bot.test/extension/answer', { method: 'POST',
    headers: { Authorization: `Bearer ${env.EXTENSION_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url: JOB, fields: [{ field: 'q1', label: 'Q', type: 'text' }] }) }), noKey, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.usd, 0);
  assert.deepEqual(body.answers.map((a) => a.field), ['q1']);
  assert.equal(seen.length, 1);
});

test('AI answer endpoint: validates input and reports a missing key', async () => {
  mockFetch();
  assert.equal((await call('/extension/answer', { method: 'POST', body: { url: JOB } })).status, 400);
  const response = await call('/extension/answer', { method: 'POST', body: { url: JOB, fields: [{ field: 'q1' }] } });
  assert.equal(response.status, 503);
});

test('no job list in the extension: which job to apply to next is the desktop app\'s', async () => {
  mockFetch();
  assert.equal((await call('/extension/queue')).status, 404);
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

test('an extension fill is logged as an Agent Runs row comparable with the agent runs', async () => {
  const { logRun } = await import('../src/extension.js');
  const base = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/databases/')) return new Response(JSON.stringify({ results: [] }));
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ url: 'https://notion.so/run' }));
  };
  try {
    const result = await logRun({ NOTION_TOKEN: 't', NOTION_APPLICATIONS_DB: 'apps', NOTION_AGENT_RUNS_DB: 'runs' },
      { url: 'https://job-boards.greenhouse.io/acme/jobs/1', started: '2026-09-27T20:00:00Z', ended: '2026-09-27T20:00:12Z',
        fields: 14, unfilled: 1, usd: 0, kit: true, todo: ['Answer: Location'],
        trace: [{ label: 'Email', required: true, source: 'your details', outcome: 'filled' },
          { label: 'Location (City)', required: true, source: '', outcome: 'left', reason: 'no answer in the kit, Profile or your details' }] });
    assert.equal(result.ok, true);
    const p = sent[0].properties;
    assert.equal(sent[0].parent.database_id, 'runs');
    assert.deepEqual([p.Agent.select.name, p.ATS.select.name, p.Status.select.name, p.Minutes.number, p.Fields.number, p['Unfilled required'].number],
      ['Extension', 'Greenhouse', 'Needs input', 0.2, 14, 1]);
    assert.match(p.Learnings.rich_text[0].text.content, /1 left: no answer in the kit.*Location/);
    assert.ok(sent[0].children.some((b) => b.type === 'table' && b.table.children.length === 3));
  } finally { globalThis.fetch = base; }
});

test("a fill's per-field outcomes pass the log boundary as short rows of wording and kinds, never an answer", async () => {
  const seen = [];
  const rows = [{label: 'Formule d\'appel', type: 'combobox', outcome: 'filled', source: 'Claude', reason: '', value: 'Monsieur', extra: {a: 1}},
    ...Array.from({length: 50}, (_, i) => ({label: `Q${i} ${'x'.repeat(80)}`, type: 'text', outcome: 'left', source: '', reason: 'r'.repeat(200)}))];
  await call('/extension/log', { method: 'POST', body: { entries: [{ kind: 'fill', text: 'fields: 1 filled, 50 left', fields: { fields: rows } }] } },
    { onLog: async entries => seen.push(...entries) });
  const kept = seen[0].fields.fields;
  assert.equal(kept.length, 40);                                            // bounded
  assert.deepEqual(kept[0], {label: 'Formule d\'appel', type: 'combobox', outcome: 'filled', source: 'Claude', reason: ''});   // no value, no other key
  assert.equal(kept[1].label.length, 50);
  assert.equal(kept[1].reason.length, 80);
});

test('a likely answer the profile does not state comes back as a proposal (a knockout one too, to be checked); never for a legal or demographic question', async () => {
  const { answerForm } = await import('../src/extension.js');
  const answers = [
    { field: 'hours', value: 'Oui', confidence: 'medium', note: 'applying to this 50% role', category: 'normal', use: 'propose' },
    { field: 'visa', value: 'Yes', confidence: 'low', note: '', category: 'knockout', use: 'propose' },
    { field: 'gender', value: 'Female', confidence: 'low', note: '', category: 'demographic', use: 'propose' },
    { field: 'terms', value: 'checked', confidence: 'low', note: '', category: 'legal', use: 'propose' },
    { field: 'email', value: 'ada@example.com', confidence: 'high', note: '', category: 'contact', use: 'fill' },
  ];
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', usage: { billing: 'subscription' },
    content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers }) }] }) } };
  const traces = [];
  const fields = answers.map((a) => ({ field: a.field, label: a.field, type: 'text' }));
  const result = await answerForm({ PROFILE_TEXT: 'p', ANSWERS_TEXT: 'a', KNOWLEDGE_TEXT: '', onAnswer: (t) => traces.push(t) },
    { url: 'https://forms.example.com/apply', fields, page_text: '50% contract' }, client);
  assert.deepEqual(result.answers.map((a) => [a.field, a.use]), [['hours', 'propose'], ['visa', 'propose'], ['email', 'fill']]);
  assert.equal(traces[0].proposed, 2);
});

test('the log says which engine answered the form (Codex here), never only "the AI"', async () => {
  const { answerForm } = await import('../src/extension.js');
  const client = { engine: 'codex', messages: { create: async () => ({ stop_reason: 'end_turn', model: 'gpt-6-luna',
    usage: { billing: 'subscription', provider: 'openai', model: 'gpt-6-luna' },
    content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [] }) }] }) } };
  const traces = [];
  await answerForm({ PROFILE_TEXT: 'p', ANSWERS_TEXT: 'a', KNOWLEDGE_TEXT: '', onAnswer: (t) => traces.push(t) },
    { url: 'https://forms.example.com/apply', fields: [{ field: 'x', label: 'x', type: 'text' }], page_text: '' }, client);
  assert.deepEqual([traces[0].engine, traces[0].provider, traces[0].billing, traces[0].model], ['codex', 'openai', 'subscription', 'gpt-6-luna']);
});

test('the strategy\'s search settings go to the AI beside the profile', async () => {
  const { answerForm } = await import('../src/extension.js');
  let system = '';
  const client = { messages: { create: async (args) => { system = JSON.stringify(args.system); return { stop_reason: 'end_turn', usage: { billing: 'subscription' },
    content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [] }) }] }; } } };
  await answerForm({ PROFILE_TEXT: 'p', ANSWERS_TEXT: 'a', KNOWLEDGE_TEXT: '', SEARCH_TEXT: Promise.resolve('{"roles":["cashier"]}') },
    { url: 'https://forms.example.com/apply', fields: [{ field: 'x', label: 'x', type: 'text' }], page_text: '' }, client);
  assert.match(system, /<search_preferences>/);
  assert.match(system, /cashier/);
});

test('a fill row says who paid for its answer: the engine and its billing, a value from the fixed list only', async () => {
  const { billedTo, BILLED } = await import('../src/extension.js');
  assert.equal(billedTo({ billing: 'api', provider: 'anthropic' }), 'Anthropic API credits');
  assert.equal(billedTo({ billing: 'api', provider: 'openai' }), 'OpenAI API credits');
  assert.equal(billedTo({ billing: 'subscription', provider: 'anthropic' }), 'Claude subscription');
  assert.equal(billedTo({ billing: 'subscription', provider: 'openai' }), 'ChatGPT plan');
  assert.equal(billedTo({}), 'Anthropic API credits', 'the Worker\'s own SDK answer: no provider, Anthropic');
  for (const usage of [{ billing: 'api', provider: 'openai' }, { billing: 'subscription', provider: 'openai' }]) assert.ok(BILLED.includes(billedTo(usage)));
});

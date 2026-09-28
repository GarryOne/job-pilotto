// An Apply with Claude session's statistics for Notion Agent Runs (lib/session-stats.js, lib/session-runs.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as stats from '../lib/session-stats.js';
import * as runs from '../lib/session-runs.js';

const at = (m, s = 0) => `2026-09-29T10:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
// Working 5 min, asks (you answer in 40 s), works 3 min, form filled; you decide 12 min later.
const EVENTS = [{at: at(0), status: 'running'}, {at: at(5), status: 'input'}, {at: at(5, 40), status: 'running'},
  {at: at(8, 40), status: 'done'}, {at: at(20, 40), status: 'decided: submitted'}];

test('the timeline: minutes working and waiting, times asked, your reply time, ready → decided', () => {
  const time = stats.timeline(EVENTS, {decidedAt: at(20, 40)});
  assert.deepEqual(time, {workingMin: 8, waitingMin: 0.67, asked: 1, replyMedianS: 40, readyToDecidedMin: 12});
  assert.equal(stats.timeline([], {}).asked, 0);
});

test('the transcript: your prompts after the app\'s first, tool calls by tool, tokens counted once per message', () => {
  const lines = [
    {type: 'user', message: {content: 'Read the file … and do exactly what it says.'}},
    {type: 'assistant', message: {id: 'm1', model: 'claude-opus-5-5', usage: {input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50},
      content: [{type: 'tool_use', name: 'mcp__claude-in-chrome__find'}]}},
    {type: 'assistant', message: {id: 'm1', usage: {input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50},
      content: [{type: 'tool_use', name: 'mcp__claude-in-chrome__javascript_tool'}]}},  // the same message, another block
    {type: 'user', message: {content: [{type: 'tool_result'}]}},
    {type: 'user', message: {content: [{type: 'text', text: 'Continue.'}]}},
    {type: 'user', isMeta: true, message: {content: 'meta'}},
    {type: 'assistant', message: {id: 'm2', usage: {input_tokens: 5, output_tokens: 20}, content: [{type: 'tool_use', name: 'Bash'}]}},
  ].map(line => JSON.stringify(line)).join('\n');
  const claude = stats.transcript('t.jsonl', () => lines);
  assert.deepEqual(claude, {turns: 1, toolCalls: 3, tools: {'mcp__claude-in-chrome__find': 1, 'mcp__claude-in-chrome__javascript_tool': 1, Bash: 1},
    model: 'claude-opus-5-5', tokensIn: 65, tokensOut: 120, cacheRead: 1000});
  assert.equal(stats.toolsText(claude.tools), 'claude-in-chrome 2 · Bash 1');
  assert.equal(stats.transcript('missing.jsonl', () => { throw new Error('ENOENT'); }), null);
});

test('the Notion columns of one session', () => {
  const props = stats.properties({events: EVENTS, decidedAt: at(20, 40), outcome: 'submitted', transcript: 't', startedAt: at(0)},
    {read: () => JSON.stringify({type: 'assistant', message: {id: 'a', model: 'claude-opus-5-5', usage: {output_tokens: 7}, content: []}})});
  assert.equal(props['Claude working (min)'].number, 8);
  assert.equal(props.Outcome.select.name, 'Submitted');
  assert.equal(props['Tokens out'].number, 7);
  assert.match(props['Session timeline'].rich_text[0].text.content, /^10:00:00 running → 10:05:00 input → .* → 10:20:40 decided: submitted$/);
  assert.equal(stats.properties({events: []}).Outcome.select.name, 'Open');
});

function fakeNotion(existing = null) {
  const calls = [];
  const call = async (method, route, body) => {
    calls.push({method, route, body});
    if (route.endsWith('/query')) return {results: existing ? [{id: existing}] : []};
    if (route === 'pages') return {id: 'new-row'};
    return {};
  };
  return {calls, call};
}
const SESSION = {id: 's1', url: 'https://jobs.test/1', company: 'Acme', title: 'SRE', startedAt: at(0), events: EVENTS, outcome: 'submitted', decidedAt: at(20, 40)};

test('the row Claude recorded is updated; none is created before you decide', async () => {
  const withRow = fakeNotion('claude-row');
  assert.equal(await runs.write(SESSION, {call: withRow.call, db: 'db1'}), 'claude-row');
  assert.deepEqual(withRow.calls.map(c => c.method + ' ' + c.route), ['POST databases/db1/query', 'PATCH pages/claude-row']);
  assert.deepEqual(withRow.calls[0].body.filter.and.map(f => f.property), ['Job URL', 'Agent', 'Started']);
  const none = fakeNotion();
  assert.equal(await runs.write(SESSION, {call: none.call, db: 'db1'}), null);  // still going: wait for Claude's own row
  assert.deepEqual(none.calls.map(c => c.method), ['POST']);
});

test('at your decision, a session Claude never recorded gets its own row; a known row is patched directly', async () => {
  const none = fakeNotion();
  assert.equal(await runs.write(SESSION, {call: none.call, db: 'db1', create: true}), 'new-row');
  const created = none.calls.at(-1);
  assert.equal(created.route, 'pages');
  assert.equal(created.body.properties.Agent.select.name, 'Claude');
  assert.equal(created.body.properties.Outcome.select.name, 'Submitted');
  const known = fakeNotion();
  await runs.write({...SESSION, runPage: 'row-7'}, {call: known.call, db: 'db1'});
  assert.deepEqual(known.calls.map(c => c.method + ' ' + c.route), ['PATCH pages/row-7']);
  assert.equal(await runs.write(SESSION, {call: known.call, db: ''}), null);  // no Agent Runs database: nothing
});

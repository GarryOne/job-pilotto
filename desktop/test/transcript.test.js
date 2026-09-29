// A finished session's transcript as a conversation (lib/transcript.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversation, load, save, step} from '../lib/transcript.js';

const lines = [
  {type: 'user', message: {content: 'Apply to this job: read prompt_s1.txt'}, timestamp: 't0'},
  {type: 'assistant', message: {content: [{type: 'thinking', thinking: 'hmm'}]}},
  {type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: 'ls', description: 'Load the kit'}}]}},
  {type: 'user', message: {content: [{type: 'tool_result', content: 'ok'}]}},
  {type: 'assistant', message: {content: [{type: 'tool_use', name: 'mcp__claude-in-chrome__navigate', input: {url: 'https://www.boards.greenhouse.io/x/jobs/1'}}]}},
  {type: 'assistant', message: {content: [{type: 'tool_use', name: 'ToolSearch', input: {query: 'x'}}]}},
  {type: 'attachment'},
  {type: 'user', isMeta: true, message: {content: 'caveat'}},
  {type: 'assistant', message: {content: [{type: 'text', text: '**Filled:** name and email.\n\n- Needs you: the AI policy.'}]}, timestamp: 't9'},
].map(entry => JSON.stringify(entry)).join('\n');

test('a transcript reads as your messages, grouped steps and Claude\'s unwrapped Markdown', () => {
  const talk = conversation('x', () => lines);
  assert.deepEqual(talk.map(entry => entry.kind), ['you', 'steps', 'claude']);
  assert.deepEqual(talk[1].steps, ['⚙️ Load the kit', '🌐 Opened · boards.greenhouse.io']);  // ToolSearch says nothing
  assert.equal(talk[2].text, '**Filled:** name and email.\n\n- Needs you: the AI policy.');
  assert.equal(conversation('missing', () => { throw new Error('ENOENT'); }), null);
});

test('steps in a few words', () => {
  assert.equal(step('Read', {file_path: '/a/b/prompt_s1.txt'}), '📄 Read prompt_s1.txt');
  assert.equal(step('mcp__claude-in-chrome__form_input', {value: 'Igor'}), '🌐 Typed in the form · Igor');
  assert.equal(step('Skill', {skill: 'apply-to-job'}), '🧭 Followed the apply-to-job steps');
});

// A fake Notion: pages and blocks with children, enough for save() and load().
function fakeNotion() {
  const kids = new Map([['row', [{id: 'old', type: 'toggle', toggle: {rich_text: [{plain_text: '💬 Conversation · 2 messages and steps'}]}}]]]);
  let n = 0;
  const call = async (method, route, body) => {
    const id = route.split('/')[1];
    if (method === 'GET') return {results: kids.get(id) || [], has_more: false};
    if (method === 'DELETE') { for (const [key, list] of kids) kids.set(key, list.filter(block => block.id !== id)); return {}; }
    const made = body.children.map(child => ({...child, id: `b${++n}`,
      [child.type]: {...child[child.type], rich_text: (child[child.type].rich_text || []).map(part => ({...part, plain_text: part.text.content}))}}));
    kids.set(id, [...(kids.get(id) || []), ...made]);
    return {results: made};
  };
  return {call, kids};
}

test('the conversation goes on the Agent Runs row (replacing an older copy) and reads back from it', async () => {
  const talk = conversation('x', () => lines);
  const {call, kids} = fakeNotion();
  assert.equal(await save(call, 'row', talk), 3);
  assert.deepEqual(kids.get('row').map(block => block.id), ['b1']);  // the old toggle replaced, one left
  const back = await load(call, 'row');
  assert.deepEqual(back.map(entry => entry.kind), ['you', 'steps', 'claude']);
  assert.equal(back[1].count, 2);
  assert.equal(back[2].text, '**Filled:** name and email.\n- Needs you: the AI policy.');  // bold kept
  assert.equal(await load(call, 'elsewhere'), null);
});

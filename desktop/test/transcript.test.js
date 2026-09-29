// A finished session's transcript as a conversation (lib/transcript.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversation, step} from '../lib/transcript.js';

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

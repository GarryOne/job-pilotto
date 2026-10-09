// Interviews → Open review in the app (renderer/interview-review-view.js): the Notion page's content from the store's record.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {markdownGroups, reviewParts} from '../renderer/interview-review-view.js';

test('the review: facts, the step and the weak spots first, then the review by its headings, then the transcript', () => {
  const parts = reviewParts({title: 'Acme · SRE', round: 'Technical', overall: 'Positive', questions: 7, at: '2026-10-08T14:00',
    next_step: 'Send the follow-up', weak_answers: ['Q3: too long'], weak_topics: '- Kubernetes networking\n- On-call stories',
    review: 'Strong start.\n## Question by question\n- Q1: clear\n1. Q2: vague\n### Advice\nSlow down.', transcript: 'Interviewer: hi\nYou: hello'});
  assert.equal(parts.title, 'Acme · SRE');
  assert.equal(parts.facts, 'Technical · Overall: Positive · 7 questions · 2026-10-08');
  assert.deepEqual(parts.groups.map(g => g.title), ['Next step', 'Answers to work on', 'Topics to work on', 'Review', 'Question by question', 'Advice']);
  assert.deepEqual(parts.groups[2].lines, ['Kubernetes networking', 'On-call stories']);
  assert.deepEqual(parts.groups[4].lines, ['Q1: clear', 'Q2: vague']);
  assert.deepEqual(parts.transcript, ['Interviewer: hi', 'You: hello']);
});

test('nothing reviewed yet: no groups, and text stays text', () => {
  assert.deepEqual(reviewParts({title: 'x'}).groups, []);
  assert.deepEqual(markdownGroups('<b>bold</b>'), [{title: 'Review', lines: ['<b>bold</b>']}]);
});

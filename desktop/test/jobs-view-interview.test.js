// Interviews → a saved interview's job (renderer/jobs-view.js): found by the store's id on SQLite (where a job has no Notion page, and
// the list's own `id` is null: the job is known by `code` and `page_id`), by its Notion page on Notion; the fallback says where it is.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {interviewJob, jobOfApplication} from '../renderer/jobs-view.js';

const sqliteJob = {id: null, code: 'ab12cd', url: 'https://jobs.test/1', title: 'SRE', company: 'Acme', notion_url: '', page_id: 'a3f1c2d4e5'};
const notionJob = {id: 4, code: 'x', url: 'https://jobs.test/2', title: 'SRE', company: 'Beta', notion_url: 'https://www.notion.so/SRE-0123abcd4567', page_id: '0123abcd-4567'};

test('an interview finds its job on SQLite by the store\'s id, on Notion by its page', () => {
  assert.equal(jobOfApplication([notionJob, sqliteJob], 'a3f1c2d4e5'), sqliteJob);
  assert.equal(jobOfApplication([sqliteJob, notionJob], '0123abcd4567'), notionJob);
  assert.equal(jobOfApplication([sqliteJob], ''), undefined);
  const row = {application: ['a3f1c2d4e5']};
  assert.deepEqual(interviewJob(row, jobOfApplication([sqliteJob], 'a3f1c2d4e5'), {links: false}),
    {kind: 'job', name: 'Acme', role: 'SRE', notion: ''}, 'no Notion link made up from a store id');
});

test('a linked job not in the list: "Linked in Notion" with its page on Notion; said plainly, with no link, on this Mac', () => {
  const row = {application: ['a3f1c2d4e5']};
  assert.deepEqual(interviewJob(row, undefined, {links: true}), {kind: 'notion', name: 'Linked in Notion', role: '', notion: 'https://www.notion.so/a3f1c2d4e5'});
  assert.deepEqual(interviewJob(row, undefined, {links: false}), {kind: 'none', name: 'Linked to a job', role: '', notion: ''});
});

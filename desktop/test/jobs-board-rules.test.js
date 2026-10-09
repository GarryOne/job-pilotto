// Jobs → Board and the saved views (renderer/jobs-board-rules.js): the 10 views of the Applications database, the Fresh formula, the columns
// and which app action a drop asks for.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {boardColumns, columnOf, dropFor, fresh, inView, OUTCOME_STAGES, STAGES, takesDrop, VIEWS} from '../renderer/jobs-board-rules.js';

const schema = JSON.parse(fs.readFileSync(new URL('../../config/notion_schema.json', import.meta.url), 'utf8'));
// The Applications database: the one whose Stage select has the most options (Application Events has a Kind, not a Stage).
const findStage = node => (node && typeof node === 'object' ? (node.Stage?.options ? [node.Stage.options] : []).concat(...Object.values(node).map(findStage)) : []);
const stageOptions = findStage(schema.databases).sort((a, b) => b.length - a.length)[0]?.map(option => option.name);
const NOW = Date.parse('2026-10-09T12:00:00Z');
const job = (stage, extra = {}) => ({url: `https://x.test/${stage}`, title: stage, stage, ...extra});

test('the board has a column for every Applications stage in the schema, and nothing else', () => {
  assert.ok(stageOptions?.length, 'Stage options read from config/notion_schema.json');
  assert.deepEqual([...STAGES].sort(), [...stageOptions].sort());
});

test('the 10 saved views of the Applications database, each a Stage set as in Notion', () => {
  assert.deepEqual(VIEWS.map(view => view.label), ['All applications', 'Active', 'In progress', 'Kit ready', 'Saved', 'Closed', 'Dismissed', 'All', 'Rejected', 'This week']);
  const of = id => STAGES.filter(stage => inView(job(stage), id, NOW));
  assert.deepEqual(of('active'), ['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer']);
  assert.deepEqual(of('all-applications'), ['Applying', 'Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer', 'Rejected', 'No response', 'Withdrawn']);
  assert.deepEqual(of('rejected'), ['Rejected', 'No response', 'Withdrawn']);
  for (const [id, stage] of [['in-progress', 'Applying'], ['kit-ready', 'Kit ready'], ['saved', 'Saved'], ['closed', 'Closed'], ['dismissed', 'Dismissed']]) assert.deepEqual(of(id), [stage], id);
  assert.deepEqual(of('all'), STAGES, 'All = every Applications row');
  assert.equal(inView({url: 'u', stage: ''}, 'all', NOW), false, 'a job match without a row is in no view');
});

test('This week is the Fresh formula: applied at most 7 days ago, whatever the stage', () => {
  assert.equal(fresh({applied_on: '2026-10-02'}, NOW), true);
  assert.equal(fresh({applied_on: '2026-10-01'}, NOW), false);
  assert.equal(fresh({applied_on: ''}, NOW), false);
  assert.equal(inView(job('Rejected', {applied_on: '2026-10-08'}), 'this-week', NOW), true);
});

test('columns keep funnel order and the order of the jobs given', () => {
  const columns = boardColumns([job('Offer'), job('Saved'), {...job('Saved'), url: 'b'}, {url: 'n', stage: ''}]);
  assert.deepEqual(columns.map(column => column.stage), STAGES);
  assert.deepEqual(columns.find(column => column.stage === 'Saved').jobs.map(item => item.url), ['https://x.test/Saved', 'b']);
  assert.equal(columns.reduce((sum, column) => sum + column.jobs.length, 0), 3, 'a job without a stage is not on the board');
});

test('a drop asks the app, never writes a stage itself: setStatus for Saved/Applied/Dismissed, setStage for outcomes, refused otherwise', () => {
  const applied = job('Applied');
  assert.deepEqual(dropFor(applied, 'Saved'), {call: 'setStatus', arg: 'saved'});
  assert.deepEqual(dropFor(job('Saved'), 'Applied'), {call: 'setStatus', arg: 'applied'});
  assert.deepEqual(dropFor(applied, 'Dismissed'), {call: 'setStatus', arg: 'dismissed'});
  for (const stage of OUTCOME_STAGES) assert.deepEqual(dropFor(applied, stage), {call: 'setStage', arg: stage}, stage);
  for (const stage of ['Kit ready', 'Applying', 'Closed', 'Recruiter lead']) {
    assert.match(dropFor(applied, stage).refused, /set by Job Pilotto/, stage);
    assert.equal(takesDrop(stage), false, stage);
  }
  assert.deepEqual(dropFor(applied, 'Applied'), {none: true});
  // Every stage is either a drop target or explained: a new stage in the schema must be placed here.
  for (const stage of STAGES) assert.ok(takesDrop(stage) || dropFor(applied, stage).refused || stage === 'Applied', stage);
});

test('setStage accepts only the outcome stages the engine logs as events (src/notion/ledger.py OUTCOME_STAGES)', () => {
  const ledger = fs.readFileSync(new URL('../../src/notion/ledger.py', import.meta.url), 'utf8');
  const engine = ledger.match(/OUTCOME_STAGES = \(([^)]*)\)/s)[1].match(/'([^']+)'/g).map(word => word.slice(1, -1));
  assert.deepEqual([...OUTCOME_STAGES].sort(), engine.filter(stage => stage !== 'Applied').sort());
});

// A job marked Applied or Dismissed only on its Job Matches row has no Stage (src/desktop_jobs.py), and the list counts and labels it: the
// board shows it in that column too (9 Oct 2026, the UI audit: Applied read 0 while the list had an Applied job). Its Stage, when it has one, wins.
test('a job with no Stage sits in the column its status stands for; one nobody acted on has none', () => {
  const jobs = [{url: 'a', status: 'applied'}, {url: 'd', status: 'dismissed'}, {url: 's', status: 'saved'}, {url: 'u', status: 'unreviewed'},
    {url: 'i', status: 'applied', stage: 'Interview scheduled'}];
  const at = Object.fromEntries(boardColumns(jobs).map(column => [column.stage, column.jobs.map(job => job.url)]));
  assert.deepEqual([at.Applied, at.Dismissed, at.Saved, at['Interview scheduled']], [['a'], ['d'], ['s'], ['i']]);
  assert.equal(columnOf({status: 'unreviewed'}), '');
  assert.equal(boardColumns(jobs).reduce((n, column) => n + column.jobs.length, 0), 4, 'the unreviewed job is on no column');
});

test('the saved views count a job by the same column as the board: a stageless Applied job is in All applications and All', () => {
  const applied = {url: 'a', status: 'applied'}, dismissed = {url: 'd', status: 'dismissed'}, fresh = {url: 'u', status: 'unreviewed'};
  assert.deepEqual(['all-applications', 'all', 'dismissed', 'saved'].map(id => [applied, dismissed, fresh].filter(job => inView(job, id, NOW)).map(job => job.url)),
    [['a'], ['a', 'd'], ['d'], []]);
});

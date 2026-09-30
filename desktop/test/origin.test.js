// Outbound or inbound: the window's rule gives the same answers as the Python one (one shared table).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {isInbound, origin} from '../renderer/origin.js';

const TABLE = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/opportunity_origin.json', import.meta.url), 'utf8'));

test('every case of the shared table (tests/fixtures/opportunity_origin.json)', () => {
  assert.ok(TABLE.cases.length >= 10);
  for (const {name, row, origin: expected} of TABLE.cases) assert.equal(origin(row), expected, name);
});

test('a job without any of the fields is outbound', () => {
  assert.equal(origin(), 'outbound');
  assert.equal(isInbound(null), false);
  assert.equal(isInbound({source: 'Phone'}), true);
});

test("the job's Origin column decides the Inbound list, the counts and In conversation", async () => {
  const {inStatus, inboundCount, inConversation} = await import('../renderer/jobs-view.js');
  const saved = {stage: 'Recruiter lead', source: 'Gmail', origin: 'Outbound', status: 'saved'};  // you saved it first
  const found = {stage: 'Screening', source: 'Job Pilotto app', origin: 'Inbound', kinds: ['Applied']};
  const older = {stage: 'Recruiter lead', source: 'Gmail', origin: ''};  // before the column: derived
  assert.equal(inStatus(saved, 'inbound'), false);
  assert.equal(inStatus(found, 'inbound'), true);
  assert.equal(inboundCount([saved, found, older]), 2);
  assert.deepEqual(inConversation([saved, found, older]).map(j => j.origin), ['Inbound', '']);
});

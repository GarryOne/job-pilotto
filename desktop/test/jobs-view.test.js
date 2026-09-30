import assert from 'node:assert/strict';
import {test} from 'node:test';
import {interviewJob, notionPageUrl, ago, applicationStats, avatar, inProcess, band, byStat, isStuck, matchLabel, placeAndMode, sorted, stats, statusPill, tags, workMode} from '../renderer/jobs-view.js';

test('place and mode on one line say the mode once', () => {
  assert.equal(placeAndMode('Remote (Europe)', 'Remote'), 'Remote (Europe)');
  assert.equal(placeAndMode('Germany (Remote)', 'Remote (stated)'), 'Germany (Remote)');
  assert.equal(placeAndMode('Zurich', 'Hybrid'), 'Zurich · Hybrid');
  assert.equal(placeAndMode('', 'On-site'), 'On-site');
  assert.equal(placeAndMode('Bern', ''), 'Bern');
});

test('compact list: match label and age', () => {
  assert.deepEqual([matchLabel(78), matchLabel(62), matchLabel(30), matchLabel(null)], ['Strong match', 'Good match', 'Weak match', 'Not scored']);
  const now = Date.parse('2026-09-28T12:00:00Z');
  assert.equal(ago('2026-09-28T11:30:00Z', now), 'just now');
  assert.equal(ago('2026-09-28T07:00:00Z', now), '5h ago');
  assert.equal(ago('2026-09-25T12:00:00Z', now), '3d ago');
  assert.equal(ago('2026-09-07T12:00:00Z', now), '3w ago');
  assert.equal(ago('', now), '');
  assert.equal(ago('2099-01-01', now), '');  // a date in the future: no age
});

test('tags come from the title and fit summary, at most four, no false "Go"', () => {
  assert.deepEqual(tags({title: 'Senior SRE', reason: 'Kubernetes on AWS, OpenTelemetry rollout'}), ['SRE', 'OpenTelemetry', 'Kubernetes', 'AWS']);
  assert.deepEqual(tags({title: 'Backend Engineer', reason: 'Strong Go and Postgres'}), ['Go', 'Databases']);
  assert.deepEqual(tags({title: 'Engineer', reason: 'Good fit; we go remote'}), []);
  assert.equal(tags({title: 'SRE devops platform', reason: 'kubernetes aws terraform python'}).length, 4);
});

test('the counters: total, high fit, new this week, unique companies', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const jobs = [
    {fit: 80, company: 'Acme', first_seen_at: '2026-09-27'},
    {fit: 70, company: 'acme ', first_seen_at: '2026-09-01'},
    {fit: 40, company: 'Globex', first_seen_at: ''},
    {fit: null, company: '', first_seen_at: '2026-09-22'},
  ];
  assert.deepEqual(stats(jobs, 214, now), {total: 214, high: 2, week: 2, companies: 2});
  assert.equal(stats(jobs, undefined, now).total, 4);
});

test('clicking a counter shows the jobs it counts', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const jobs = [
    {fit: 60, company: 'Acme', first_seen_at: '2026-09-27'},
    {fit: 80, company: 'acme ', first_seen_at: '2026-09-01'},
    {fit: null, company: 'Globex', first_seen_at: '2026-09-22'},
    {fit: 90, company: '', first_seen_at: ''},
  ];
  assert.deepEqual(byStat(jobs, 'high', now), [jobs[1], jobs[3]]);
  assert.deepEqual(byStat(jobs, 'week', now), [jobs[0], jobs[2]]);
  assert.deepEqual(byStat(jobs, 'companies', now), [jobs[1], jobs[2]]);  // Acme's best fit, list order kept
  assert.equal(byStat(jobs, null, now), jobs);
  assert.equal(byStat(jobs, 'companies').length, stats(jobs).companies);
});

test('application counters follow the Notion stage, with the funnel\'s stage sets', () => {
  const jobs = [
    {status: 'applied', stage: 'Applied'}, {status: 'applied', stage: 'Interviewing'}, {status: 'applied', stage: 'Rejected'},
    {status: 'applied', stage: 'No response'}, {status: 'saved', stage: 'Saved'}, {status: 'unreviewed', stage: ''},
    {status: 'applied', stage: 'Applying'},  // a form still being filled: not sent, not counted
    {status: 'applied', stage: 'Screening'},
  ];
  // Sent = waiting + in process + closed: the boxes add up.
  assert.deepEqual(applicationStats(jobs), {applied: 5, waiting: 1, interviews: 2, closed: 2});
  assert.equal(5, 1 + 2 + 2);
  assert.deepEqual(inProcess(jobs), {screening: 1, interviews: 1});
  assert.deepEqual(byStat(jobs, 'waiting'), [jobs[0]]);
  assert.deepEqual(byStat(jobs, 'closed'), [jobs[2], jobs[3]]);
});

test('Applying is stuck only when no session explains it', () => {
  const job = {stage: 'Applying', url: 'https://jobs.test/1'};
  assert.equal(isStuck(job, () => false), true);
  assert.equal(isStuck(job, () => true), false);  // a session for it is open: it is in progress, not stuck
  assert.equal(isStuck({stage: 'Applied'}, () => false), false);
});

test('sorting keeps the engine order for best match; newest and company reorder a copy', () => {
  const jobs = [{company: 'B', first_seen_at: '2026-09-01'}, {company: 'a', first_seen_at: '2026-09-20'}, {company: 'C', first_seen_at: ''}];
  assert.deepEqual(sorted(jobs, 'best'), jobs);
  assert.deepEqual(sorted(jobs, 'newest').map(j => j.company), ['a', 'B', 'C']);
  assert.deepEqual(sorted(jobs, 'company').map(j => j.company), ['a', 'B', 'C']);
  assert.equal(jobs[0].company, 'B');
});

test('company badges: initials and a stable colour; fit bands', () => {
  assert.equal(avatar('Northwind Robotics').initials, 'NR');
  assert.equal(avatar('Twilio').initials, 'TW');
  assert.equal(avatar('').initials, '?');
  assert.equal(avatar('Acme').hue, avatar('Acme').hue);
  assert.deepEqual([band(null), band(85), band(70), band(55), band(10)], ['none', 'high', 'high', 'mid', 'low']);
});

test('work-mode chip: one word for a known mode, the source wording otherwise', () => {
  assert.deepEqual(workMode('Remote (stated)'), {kind: 'remote', label: 'Remote'});
  assert.deepEqual(workMode('Hybrid'), {kind: 'hybrid', label: 'Hybrid'});
  assert.deepEqual(workMode('On site'), {kind: 'onsite', label: 'On-site'});
  assert.deepEqual(workMode('Flexible'), {kind: '', label: 'Flexible'});
});

test('an application shows its Notion Stage, e.g. Rejected rather than Applied', () => {
  assert.deepEqual(statusPill({status: 'applied', stage: 'Rejected'}), {label: 'Rejected', tone: 'bad'});
  assert.deepEqual(statusPill({status: 'applied', stage: 'Interviewing'}), {label: 'Interviewing', tone: 'info'});
  assert.deepEqual(statusPill({status: 'applied', stage: 'Applied'}), {label: 'Applied', tone: 'good'});
  assert.deepEqual(statusPill({status: 'applied'}), {label: 'Applied', tone: 'good'});
  assert.deepEqual(statusPill({status: 'unreviewed'}), {label: 'New', tone: 'info'});
  assert.deepEqual(statusPill({status: 'saved', stage: 'Recruiter lead'}), {label: 'Recruiter lead', tone: 'signal'});
});
test('feedback is visible beside Rejected while the funnel still counts one closed application', () => {
  const asked = {status: 'applied', stage: 'Rejected', feedback_status: 'Asked for feedback'};
  const received = {...asked, feedback_status: 'Received feedback'};
  assert.deepEqual(statusPill(asked), {label: 'Rejected · Asked for feedback', tone: 'warn'});
  assert.deepEqual(statusPill(received), {label: 'Rejected · Received feedback', tone: 'info'});
  assert.deepEqual(applicationStats([received]), {applied: 1, waiting: 0, interviews: 0, closed: 1});
});

test('the Interviews Job cell: a listed job opens in Jobs, a Notion-only link opens in Notion, none offers Link a job', () => {
  const job = {company: 'Grafana Labs', title: 'SRE', url: 'https://x.test/g', notion_url: 'https://www.notion.so/g1'};
  assert.deepEqual(interviewJob({application: ['g-1']}, job), {kind: 'job', name: 'Grafana Labs', role: 'SRE', notion: 'https://www.notion.so/g1'});
  assert.equal(interviewJob({application: ['a-1-2']}, {title: 'SRE', url: 'u'}).notion, 'https://www.notion.so/a12');
  assert.deepEqual(interviewJob({application: ['a-1-2']}, null), {kind: 'notion', name: 'Linked in Notion', role: '', notion: notionPageUrl('a-1-2')});
  assert.deepEqual(interviewJob({application: []}, null), {kind: 'none', name: 'No job linked', role: '', notion: ''});
});

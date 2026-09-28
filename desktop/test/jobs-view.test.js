import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ago, applicationStats, avatar, band, byStat, matchLabel, placeAndMode, sorted, stats, statusPill, tags, workMode} from '../renderer/jobs-view.js';

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

test('application counters follow the Notion stage', () => {
  const jobs = [
    {status: 'applied', stage: 'Applied'}, {status: 'applied', stage: 'Interviewing'}, {status: 'applied', stage: 'Rejected'},
    {status: 'applied', stage: 'No response'}, {status: 'saved', stage: 'Saved'}, {status: 'unreviewed', stage: ''},
  ];
  assert.deepEqual(applicationStats(jobs), {applied: 4, active: 2, interviews: 1, rejected: 1});
  assert.deepEqual(byStat(jobs, 'active'), [jobs[0], jobs[1]]);
  assert.deepEqual(byStat(jobs, 'rejected'), [jobs[2]]);
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

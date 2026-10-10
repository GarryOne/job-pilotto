// The job drawer (pages/job-panel.js, renderer/job-drawer/): one body per tab, every state through the one state card, one overlay slot with
// Recent activity, the drawer never resizing the list. Source checks, as the other page tests (the DOM runs in the app and `npm run shot`).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {TABS} from '../renderer/job-page-view.js';
import {claimOverlay, registerOverlay, releaseOverlay, reopenOverlay} from '../renderer/overlay-slot.js';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

test('every tab has a body module, wired by its key, and each says "nothing yet" through the state card', () => {
  const bodies = read('job-drawer/tabs-body.js');
  for (const [key] of TABS) {
    assert.match(bodies, new RegExp(`\\b${key}: ${key}Tab\\b`), `${key} is wired`);
    const source = read(`job-drawer/tab-${key}.js`) + (key === 'application' ? read('job-drawer/application-preparation.js') + read('job-drawer/application-submitted.js') : '');
    assert.match(source, /stateCard\(/, `${key} has its empty state (Application: in its two parts)`);
    assert.doesNotMatch(source, /createElement|innerHTML/, `${key} is built from the shared parts`);
  }
  assert.equal((bodies.match(/Tab\b/g) || []).length >= TABS.length * 2, true);
});

test('no tab draws its own state box, copy button or group: they are the shared parts', () => {
  for (const [key] of TABS) assert.doesNotMatch(read(`job-drawer/tab-${key}.js`), /el\('div', 'alert|function copyButton|function group\(/, key);
  const panel = read('pages/job-panel.js');
  assert.match(panel, /stateCard\(\{icon: 'alert', tone: 'bad', title: 'Could not read this job'/);
  assert.match(panel, /actions: \[button\('Retry'/, 'Retry only after a failure');
});

test('the drawer is an overlay: it does not resize or hide the list, and it shares Recent activity\'s slot', () => {
  const panel = read('pages/job-panel.js');
  assert.doesNotMatch(panel, /compact|has-panel|jobs-split|jobs-head/, 'the list is left as it is');
  assert.match(panel, /claimOverlay\('job'\)/);
  assert.match(panel, /registerOverlay\('job'/);
  assert.match(read('pages/activity-panel.js'), /claimOverlay\('activity'\)[\s\S]*registerOverlay\('activity'/);
  assert.match(read('job-drawer.css'), /\.job-drawer \{ position: absolute; top: 0; right: 0; bottom: 0; width: min\(960px, 100%\)/);
});

test('the tab strip scrolls sideways, the header and tabs stay, the body scrolls on its own', () => {
  const css = read('job-drawer.css');
  assert.match(css, /\.jd-tabs \{[^}]*overflow-x: auto; white-space: nowrap/);
  assert.match(css, /\.jd-body \{ flex: 1; min-height: 0; overflow-y: auto/);
  assert.match(css, /\.jd-head \{ flex: none/);
});

test('Application: Preparation and Submitted through the shared choice, each with its own empty state; Submitted never edits', () => {
  const tab = read('job-drawer/tab-application.js');
  assert.match(tab, /choice\(OPTIONS, active/);
  assert.match(tab, /ctx\.parts\.submitted \? 'submitted' : 'preparation'/, 'opens on what was sent when there is a snapshot');
  assert.match(read('job-drawer/application-preparation.js'), /Not prepared/);
  const submitted = read('job-drawer/application-submitted.js');
  assert.match(submitted, /No application snapshot captured/);
  assert.match(submitted, /Not submitted yet/);
  assert.match(submitted, /do not change this snapshot/);
  assert.doesNotMatch(submitted, /contenteditable|<textarea|createElement\('textarea'/, 'a snapshot is read-only');
});

test('Messages: a filter with counts, folding email cards, Add note, and Gmail-not-connected says so', () => {
  const source = read('job-drawer/tab-messages.js');
  assert.match(source, /choice\(\[\['all', `All \$\{counts\.all\}`\], \['email'/);
  assert.match(source, /foldCard\(/);
  assert.match(source, /openLogFor\(job\.url, job\.title\)/, 'Add note opens the Log box on this job');
  assert.match(source, /gmailConnected\(\) === false/, 'only when known not connected');
  assert.match(source, /openSetting\('google'\)/);
  assert.match(source, /No linked messages yet/);
  assert.match(source, /No emails linked to this job/);
  assert.match(read('pages/job-panel.js'), /close: closeJobPanel/);
});

test('Timeline: a filter with counts, entries with the way to their detail, Add note; the capture script covers every tab', () => {
  const source = read('job-drawer/tab-timeline.js');
  assert.match(source, /choice\(options, active/);
  assert.match(source, /timelineOf\(page\?\.events, job, page\?\.match, parts\)/);
  assert.match(source, /openLogFor\(job\.url, job\.title\)/);
  assert.match(source, /showSubmitted\(job\.url\); pick\(tab\)/, 'View snapshot opens what was sent');
  assert.match(source, /Nothing has happened yet/);
  const shots = fs.readFileSync(new URL('../scripts/drawer-shots.mjs', import.meta.url), 'utf8');
  for (const [key] of TABS) assert.ok(shots.includes(`'${key}'`), `drawer-shots has a picture of ${key}`);
});

test('Interviews and Review: cards that fold, the way from an interview to its review, and a choice between reviews', () => {
  const interviews = read('job-drawer/tab-interviews.js'), review = read('job-drawer/tab-review.js');
  assert.match(interviews, /foldCard\(/);
  assert.match(interviews, /showReview\(job\.url, `iv-\$\{record\.key\}`\); pick\('review'\)/, 'View interview review opens that review');
  assert.match(interviews, /No interviews yet/);
  assert.match(review, /choice\(reviews\.map/, 'a choice only when there is more than one');
  assert.match(review, /reviews\.length > 1/);
  assert.match(review, /No review yet/);
});

test('Description: Fetch original and Paste description only for a job with an application; a failed fetch keeps Try again and Paste; a not-seen posting says so', () => {
  const source = read('job-drawer/tab-description.js');
  assert.match(source, /window\.pilot\.describeJob\(app, '', job\.url\)/, 'fetch: the posting\'s page');
  assert.match(source, /window\.pilot\.describeJob\(app, field\.value, ''\)/, 'paste: the person\'s own text');
  assert.match(source, /if \(app\) actions\.push\(\.\.\.buttons\(\)\)/, 'a job with no application has nowhere to keep it');
  assert.match(source, /Could not retrieve the page/);
  assert.match(source, /Try again, or paste the description/);
  assert.match(source, /notSeen\(page\) \? \[closedCard\(\)\]/);
  assert.match(read('job-drawer/tab-overview.js'), /notSeen\(page\)/);
  assert.match(read('job-drawer/header.js'), /Not seen lately/);
});

test('Review: a rejection shows the employer\'s words, or that the email gave no reason, before the AI suggestions', () => {
  const source = read('job-drawer/tab-review.js');
  assert.match(source, /Employer statement/);
  assert.match(source, /The email does not give a specific reason/);
  assert.match(source, /AI suggestions/);
  assert.match(source, /not confirmed rejection reasons/);
  assert.match(source, /active\.key === 'rejection'/);
});

test('Messages: an email waiting on this job asks first, and its answer reuses the Focus actions', () => {
  const source = read('job-drawer/tab-messages.js');
  assert.match(source, /waitingEmails\(focusItems\(\), job\.url\)/);
  assert.match(source, /Does this email belong to this job\?/);
  assert.match(source, /moveEmail\(email\.eventId, job\.url, email\.item\)/, 'Link to this job: the Focus move');
  assert.match(source, /whichJob\(email\.item/, 'Choose another job: the Focus picker');
  assert.match(read('pages/focus.js'), /export const focusItems = \(\) => lastFocus\?\.items \|\| \[\]/);
});

test('The last states: Check now and scoring in progress, Add interview and Prepare, the gone-posting message', () => {
  const match = read('job-drawer/tab-match.js');
  assert.match(match, /Scoring in progress/);
  assert.match(match, /lastActivity\?\.running/, 'a check is running');
  assert.match(match, /document\.getElementById\('refresh'\)\.click\(\)/, 'Check now is the Jobs page\'s own');
  assert.match(read('job-drawer/tab-interviews.js'), /button\('Add interview', \(\) => openLogFor\(job\.url, job\.title\)/);
  assert.match(read('job-drawer/header.js'), /page\?\.app\?\.id \? 'Prepare →' : 'Open interviews →'/);
  assert.match(read('pages/job-panel.js'), /openPrep\(\{page_id: page\.app\.id/);
  assert.match(read('job-drawer/tab-description.js'), /The saved copy is no longer available/);
});

test('Overview: built from the shared card, tile and state-card parts, each part only when it has something', () => {
  const source = read('job-drawer/tab-overview.js');
  for (const part of ['card(', 'factTile(', 'iconRow(', 'stateCard(', 'glanceTiles(', 'clarifyOf(', 'callFacts(']) assert.ok(source.includes(part), part);
  assert.match(source, /Worth clarifying/);
  assert.match(source, /From your conversations/);
  assert.match(read('job-drawer/header.js'), /nextInterview\(page\?\.app\)/, 'the next interview is on every tab\'s header');
});

test('Description: reads the saved posting once per job, and offers Retry only after a failure', () => {
  const source = read('job-drawer/tab-description.js');
  assert.match(source, /window\.pilot\.jobPosting\(job\.url\)/);
  assert.match(source, /read\.has\(job\.url\)/, 'asked once per job');
  assert.match(source, /answer\.failed[\s\S]*button\('Retry'/, 'Retry only on a failed read');
  assert.match(source, /This job has no saved description/);
  assert.match(source, /factStrip\(postingFacts\(/, 'the strip of facts');
  assert.match(source, /postingBody\(postingBlocks\(text\)\)/, 'headings and bullets, not one block');
  assert.match(source, /sourceCard\(postingSource\(found\)/, 'where it came from, with the way to the original');
  assert.match(fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), /jobPosting: call\('jobPosting'\)/);
});

test('every job row shows a pointer: a click anywhere on it opens the drawer, the score cell too when it has no analysis', () => {
  assert.match(read('style.css'), /\.job-row \{ cursor: pointer; \}/);
  assert.match(read('style.css'), /\.job-row \.fit-detail \{ cursor: default; \}/, 'the open analysis is not a click target');
  assert.match(read('pages/jobs-render.js'), /!\(canOpen && fit\.contains\(event\.target\)\)[\s\S]{0,120}openJobPanel\(job\)/);
});

test('one score ring for the list and the drawer', () => {
  assert.match(read('pages/jobs-render.js'), /fitRing\(job\.fit\)/);
  assert.match(read('job-drawer/header.js'), /fitRing\(job\.fit, 'lg'\)/);
});

test('the overlay slot: opening one surface closes the other and says which it displaced; Back reopens it', () => {
  const log = [];
  registerOverlay('a', {close: () => { log.push('close a'); releaseOverlay('a'); }, open: () => { claimOverlay('a'); log.push('open a'); }});
  registerOverlay('b', {close: () => { log.push('close b'); releaseOverlay('b'); }, open: () => log.push('open b')});
  assert.equal(claimOverlay('a'), '', 'nothing was showing');
  assert.equal(claimOverlay('b'), 'a', 'b displaced a');
  assert.deepEqual(log, ['close a']);
  releaseOverlay('b');
  reopenOverlay('a');
  assert.deepEqual(log, ['close a', 'open a']);
  assert.equal(claimOverlay('a'), '', 'a is showing alone again');
});

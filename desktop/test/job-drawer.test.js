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

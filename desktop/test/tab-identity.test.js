// A session's form tab is known by (browser run, tab id), never by its address, and survives every restart but Chrome's own
// (owner, 8 Oct 2026: an extension update and an app restart left the open Coop form showing "Form closed" for good).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test, beforeEach} from 'node:test';
import * as review from '../lib/review.js';
import {snapshot, startRun} from '../../extension/tab-memory.js';

const coop = {id: 's1', url: 'https://jobs.coop.ch/Coop/job/Nyon-Assistante/1405093533/', company: 'Coop Suisse', status: 'ended', startedAt: '2026-10-08T13:09:15Z'};
const form = (tab, boot, extra = {}) => ({url: 'https://career2.successfactors.eu/careers?company=Coop#jobpilotto-fill', title: 'Career Opportunities', tab, boot, session: 's1', left: 13, total: 19, ...extra});
const RUN = '1759928000000', NEXT = '1759990000000';
let file;
beforeEach(() => { review._reset(); file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tabs-')), 'review-states.json'); review.persist(file, ['s1']); });

test('the app restarts: the session knows its tab at once, and the next tab report says open or closed', () => {
  review.noteTabs({ids: [812], boot: RUN});
  review.report([coop], form(812, RUN));
  review._reset(); review.persist(file, ['s1']);           // a new app process
  assert.equal(review.tabOpen('s1'), null);               // no tab report yet: not known
  review.noteTabs({ids: [5, 812], boot: RUN});
  assert.equal(review.tabOpen('s1'), true);
  review.noteTabs({ids: [5], boot: RUN});
  assert.equal(review.tabOpen('s1'), false);              // you closed it
});

test('the extension reloads (its own update, or ↻ by hand): its tab memory and run id come back, the form stays open', () => {
  const items = {boot: RUN, 'session:812': 's1', 'armed:812': true, 'job:812': coop.url};
  const tabs = [{id: 812, url: 'https://career2.successfactors.eu/careers?company=Coop#jobpilotto-fill'}, {id: 9, url: 'https://www.youtube.com/'}];
  const kept = snapshot(items, tabs, 1000);
  assert.deepEqual(kept.tabs, {812: 'career2.successfactors.eu'});   // only the tabs it remembers something about
  const run = startRun({kept, tabsNow: tabs});               // no time limit: a reload by hand hours later is the same run
  assert.equal(run.boot, RUN);
  assert.deepEqual(run.restore, items);
  review.noteTabs({ids: [812, 9], boot: RUN});
  review.report([coop], form(812, RUN));
  review.noteTabs({ids: [812, 9], boot: RUN});              // the reloaded extension's first report: same run
  assert.equal(review.tabOpen('s1'), true);
});

test('Chrome restarts: a new run, the old tab id means nothing, and the form is closed until a tab of the new run reports', () => {
  const kept = snapshot({boot: RUN, 'session:812': 's1'}, [{id: 812, url: 'https://career2.successfactors.eu/x'}]);
  assert.equal(startRun({kept, sawStartup: true, tabsNow: [{id: 812, url: 'https://career2.successfactors.eu/x'}]}).boot, '');
  assert.equal(startRun({kept, tabsNow: [{id: 812, url: 'https://www.google.com/'}]}).boot, '');   // no onStartup, but its tabs are gone
  assert.equal(startRun({kept: undefined}).boot, '');
  review.noteTabs({ids: [812], boot: RUN});
  review.report([coop], form(812, RUN));
  review.noteTabs({ids: [3, 812], boot: NEXT});             // tab 812 of the new run is some other page
  assert.equal(review.tabOpen('s1'), false);
  const answer = review.report([coop], form(3, NEXT));     // the form, restored by Chrome as tab 3: not "older" than 812
  assert.equal(answer.matched, 's1');
  assert.equal(review.tabOpen('s1'), true);
});

test('the tab report alone binds a session to the tab carrying it, and a restarted app keeps it', () => {
  review.noteTabs({ids: [812], boot: RUN, sessions: {812: 's1', 813: 'gone'}}, new Set(['s1']));
  assert.equal(review.tabOpen('s1'), true);
  assert.equal(review.tabOpen('gone'), null);               // not a session of this app
  review.report([coop], form(812, RUN));                     // a state on disk to carry the binding
  review._reset(); review.persist(file, ['s1']);
  review.noteTabs({ids: [812], boot: RUN});
  assert.equal(review.tabOpen('s1'), true);
});

test('an address never makes a form look closed: no tab known and none that looks like it is "not known"', () => {
  review.noteTabs({ids: [812], boot: RUN});
  review.report([coop], form(812, RUN));
  assert.deepEqual(review.formStates(['s1', 's2', 's3'], new Set(['s3'])), {ids: ['s1', 's3'], unsure: ['s2']});
  review.noteTabs({ids: [], boot: RUN});
  assert.deepEqual(review.formStates(['s1', 's2'], new Set()), {ids: [], unsure: ['s2']});   // s1: its own tab closed
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chooseTab, closeFormTab, listTabs, markedTab, mergeTabs, pickTab, reloadFormTab, reloadTarget, withOpenForm} from '../lib/form-tab.js';

const tabs = [
  {win: 1, index: 1, url: 'https://news.ycombinator.com/', title: 'Hacker News'},
  {win: 1, index: 2, url: 'https://www.example-labs.com/careers', title: 'Careers | Example Labs'},
  {win: 2, index: 1, url: 'https://job-boards.greenhouse.io/examplelabs/jobs/7012345?gh_src=abc', title: 'Job Application for SRE at Example Labs'},
  {win: 2, index: 2, url: 'https://mail.google.com/mail/u/0/', title: 'Inbox'},
];

test('the form tab: the job ID in its URL wins over the company\'s careers page', () => {
  assert.equal(pickTab(tabs, {url: 'https://www.example-labs.com/careers/jobs?gh_jid=7012345', company: 'Example Labs'}).index, 1);
  assert.equal(pickTab(tabs, {url: 'https://www.example-labs.com/careers/jobs?gh_jid=7012345', company: 'Example Labs'}).win, 2);
});

test('the posting itself, then an application-form host naming the company, then nothing', () => {
  assert.equal(pickTab(tabs, {url: 'https://www.example-labs.com/careers/', company: 'Other'}).win, 1);
  assert.equal(pickTab(tabs, {url: 'https://jobs.example/examplelabs/sre', company: 'Example Labs'}).win, 2);
  assert.equal(pickTab(tabs, {url: 'https://jobs.example/acme/sre', company: 'Acme Robotics'}), null);
});

test('at start: which sessions still have their form open, one tab per session, the job ID first', () => {
  const open = [
    {url: 'https://job-boards.greenhouse.io/canonical/jobs/7100001', title: 'Job Application for Site Reliability Engineer at Canonical'},
    {url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890', title: 'Job Application for Staff+ Engineer at Anthropic'},
    {url: 'https://mail.google.com/', title: 'Inbox'},
  ];
  const sessions = [
    {id: 'c1', company: 'Canonical', url: 'https://canonical.com/careers/7100002'},  // its tab was closed
    {id: 'c2', company: 'Canonical', url: 'https://canonical.com/careers/7100001'},  // its job ID is in the open tab
    {id: 'a1', company: 'Anthropic', url: 'https://www.anthropic.com/jobs/4567890'},
    {id: 'n1', company: 'N26', url: 'https://n26.com/careers/1234567'},
  ];
  assert.deepEqual([...withOpenForm(sessions, open)].sort(), ['a1', 'c2']);  // the one Canonical tab goes to the matching job only
  assert.deepEqual([...withOpenForm(sessions, [])], []);
});

test('reloading a tab takes the same confident match — never a guess at someone else\'s tab', () => {
  const job = {url: 'https://www.example-labs.com/careers/jobs?gh_jid=7012345', company: 'Example Labs'};
  assert.equal(reloadTarget(tabs, job).index, 1);   // the Greenhouse tab carrying the posting's job ID
  assert.equal(reloadTarget(tabs, job).win, 2);
  // A better match elsewhere still wins, and a 50 (the company in a title, nothing else) is below the bar.
  assert.equal(reloadTarget(tabs, {url: 'https://jobs.example/examplelabs/sre', company: 'Example Labs'}).win, 2);
  assert.equal(reloadTarget([{win: 1, index: 1, url: 'https://www.example-labs.com/careers', title: 'Careers | Example Labs'}],
    {url: 'https://jobs.example/examplelabs/sre', company: 'Example Labs'}), null);
  assert.equal(reloadTarget(tabs, job, 85), null);  // below the bar: no confident match, so no reload on a guess
  assert.equal(reloadTarget(tabs, {url: 'https://www.example-labs.com/careers/', company: 'Example Labs'}).win, 1);  // the posting itself
  assert.equal(reloadTarget([], job), null);
});

// Chrome's scripting dictionary is macOS-only, so off a Mac there are no tabs to see, close or reload, and asking is
// the user's job. It must not answer 'no-chrome' there: the window turns that into "Google Chrome isn't running",
// which is untrue when Chrome is open in front of them.
test('off a Mac, Chrome cannot be scripted: no tabs, nothing closed, and the reload is the user\'s to do', async () => {
  const job = {url: 'https://job-boards.greenhouse.io/examplelabs/jobs/7012345', company: 'Example Labs'};
  assert.deepEqual(await listTabs('win32'), []);
  assert.equal(await closeFormTab(job, 'win32'), false);
  assert.equal(await reloadFormTab(job, 'win32'), 'manual');
});

test('the open-form tabs come from the extension first, with Chrome\'s own scripting added where it knows more', () => {
  // The extension reports every browser it runs in, but only URLs; Chrome's scripting has titles but reaches one
  // instance — so a tab only the extension saw is still known to be open (the failure of 1 Oct 2026).
  const reported = ['https://job-boards.greenhouse.io/canonical/jobs/3014391#apply', 'https://jobs.lever.co/n26/abc'];
  const scripted = [{win: 1, index: 3, url: 'https://jobs.lever.co/n26/abc', title: 'N26 — Site Reliability Engineer'}];
  assert.deepEqual(mergeTabs(reported, scripted), [
    {url: 'https://job-boards.greenhouse.io/canonical/jobs/3014391#apply'},
    {win: 1, index: 3, url: 'https://jobs.lever.co/n26/abc', title: 'N26 — Site Reliability Engineer'},  // the titled one wins
  ]);
  assert.deepEqual(mergeTabs([], scripted), scripted);
  assert.deepEqual(mergeTabs(reported, []), [{url: reported[0]}, {url: reported[1]}]);
  assert.deepEqual(mergeTabs([], []), []);
});

test('an agency form armed by the app is the tab to show, not the plain posting tab; job boards and two candidates are not guessed', () => {
  const target = {url: 'https://www.jobs.ch/en/vacancies/detail/c59e9c97/', company: 'Undisclosed employer'};
  const posting = {win: 1, index: 1, url: 'https://www.jobs.ch/en/vacancies/detail/c59e9c97/', title: 'Développeur logiciel'};
  const agency = {win: 1, index: 4, url: 'https://api.easytemp.ch/live/bew/1577784910-FR.php#jobpilotto-fill', title: 'Software Developer'};
  assert.equal(chooseTab([posting, agency], target), agency);
  assert.equal(chooseTab([posting], target), posting);  // no armed tab: the best match, as before
  const scale = {win: 1, index: 6, url: 'https://job-boards.greenhouse.io/scaleai/jobs/4719479005#jobpilotto-fill', title: 'Scale AI'};
  assert.equal(markedTab([scale]), null);  // a job board's armed tab is matched by job ID or company, never lone-guessed
  assert.equal(markedTab([agency, {...agency, index: 5, url: 'https://other.example/form#jobpilotto-fill'}]), null);  // two: ambiguous
  assert.equal(chooseTab([scale, agency], target), agency);
});

test('a session\'s own form tab wins; another session\'s armed tab is never taken, and a closed own tab means no tab', () => {
  const target = {url: 'https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8', company: 'OpenAI'};
  const own = {win: 1, index: 2, url: 'https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8/application', title: 'OpenAI'};   // no fill mark: opened before
  const agency = {win: 1, index: 4, url: 'https://api.easytemp.ch/live/bew/1577784910-FR.php#jobpilotto-fill', title: 'Software Developer'};
  const hints = {own: own.url, claimed: ['https://api.easytemp.ch/live/bew/1577784910-FR.php']};
  // Before: the lone armed agency tab (another job's) was chosen over the right tab (1 Oct 2026, the OpenAI card opened the other card's form).
  assert.equal(chooseTab([own, agency], target, hints), own);
  assert.equal(chooseTab([agency, own], target, hints), own);
  // The OpenAI tab was closed: nothing is chosen, and the other session's tab is left alone.
  assert.equal(chooseTab([agency], target, hints), null);
  // Without hints (a session that never reported) the old rule still holds.
  assert.equal(chooseTab([agency], {url: 'https://www.jobs.ch/en/vacancies/detail/c59e9c97/', company: 'Undisclosed employer'}), agency);
});

// Which open tab is whose, as a matrix: two sessions on one form site report one address (SuccessFactors' /careers serves every
// company), so only the tab id tells them apart. 8 Oct 2026: Migros's form tab was closed and "Open in Chrome" brought Coop's forward.
test('two sessions on one form address: each finds only its own tab, a closed one finds none', () => {
  const address = 'https://career2.successfactors.eu/careers';
  const coopTab = {id: '101', win: 1, index: 3, url: `${address}?company=Coop#jobpilotto-fill`, title: 'Career Opportunities: Retail Assistant'};
  const migrosTab = {id: '102', win: 1, index: 5, url: `${address}?company=Migros#jobpilotto-fill`, title: 'Career Opportunities: Vendeuse'};
  const other = {id: '7', win: 1, index: 1, url: 'https://github.com/GarryOne/job-pilotto', title: 'GitHub'};
  const coop = {target: {url: 'https://jobs.coop.ch/coop/job/Nyon-Assistante/1234567', company: 'Coop Suisse'}, own: address, ownTab: 101};
  const migros = {target: {url: 'https://jobs.migros.ch/fr/offres/7654321', company: 'Migros Industrie / Micarna'}, own: address, ownTab: 102};
  const hints = (me, them) => ({own: me.own, ownTab: me.ownTab, claimed: [them.own], claimedTabs: [them.ownTab]});
  const cases = [
    ['both open: Coop', [other, coopTab, migrosTab], coop, migros, coopTab],
    ['both open: Migros', [other, coopTab, migrosTab], migros, coop, migrosTab],
    ['Migros closed: none, never Coop\'s', [other, coopTab], migros, coop, null],
    ['Coop closed: none, never Migros\'s', [migrosTab, other], coop, migros, null],
    ['no ids known, one address: none rather than a guess', [coopTab], {...migros, ownTab: ''}, {...coop, ownTab: ''}, null],
    ['own id reused after a Chrome restart by another site: not taken', [{...other, id: '102'}], migros, coop, null],
  ];
  for (const [name, tabs, me, them, want] of cases) assert.equal(chooseTab(tabs, me.target, hints(me, them)), want, name);
  // The 1 Oct rule is unchanged: one session alone, found by its address.
  assert.equal(chooseTab([other, coopTab], coop.target, {own: address}), coopTab);
});

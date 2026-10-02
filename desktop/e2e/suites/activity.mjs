/* global document, window */
// Actions + Recent activity when things go WRONG, and every task on the Actions page. Starts from a set-up install; resets only its own run rows in Notion.
// The jobs suite covers the happy path and the slow AI; this one covers: each task's row, words and log; the AI failing (429, 500, 401, no credit, silent);
// two things at once; a quit in the middle of a run; and the Recent activity screen itself.
import fs from 'node:fs';
import path from 'node:path';
import {badSummary, leaks, sample, watch} from '../lib/activity.mjs';
import {emptyDatabase, runRows} from '../lib/notion.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const minutes = 25;
export const name = 'activity';
const RUNS_DB = 'Cronjob Runs';

// ---------- reading the app ----------
const runsData = page => page.evaluate(async () => {
  const data = await window.pilot.runs();
  return {running: data.running ? {kind: data.running.kind || '', step: data.running.step || '', live: !!data.running.live, where: data.running.where || 'mac'} : null,
    queued: (data.queued || []).map(item => ({kind: item.kind})), historyLoaded: !!data.historyLoaded,
    runs: (data.runs || []).map(run => ({id: run.id, kind: run.kind, ok: run.ok, off: !!run.off, warned: !!run.warned, trigger: run.trigger, where: run.where, result: run.result || '',
      summary: run.summary || '', problem: run.problem || '', log: run.log || [], notionUrl: run.notionUrl || '', startedAt: run.startedAt, endedAt: run.endedAt || ''}))};
});
// The Recent runs list on the Actions page as a person reads it, newest first: {kind, pill, result}.
const shownRows = page => page.evaluate(() => [...document.querySelectorAll('#runs-table .runs-row')].map(row => ({id: row.dataset.runId || '', kind: row.querySelector('b')?.textContent || '',
  pill: row.querySelector('.ui-pill, .pill')?.textContent?.trim() || '', result: row.querySelector('.runs-result')?.textContent?.trim() || ''})));
// How the Recent runs list names each kind of task.
const LABEL = {search: 'Jobs check', mail: 'Gmail check', today: "Today's list", insight: 'Insight', weekly: 'Weekly report', scout: 'Find new employers'};
// The Recent runs list once it shows this run (the page redraws on the app's next poll, a moment after the run ended).
async function shownWith(page, id, maxMs = 25000) {
  const started = Date.now();
  let rows = await shownRows(page);
  while (!rows.some(row => row.id === String(id)) && Date.now() - started < maxMs) { await page.waitForTimeout(1000); rows = await shownRows(page); }
  return rows;
}
const sleep = (page, ms) => page.waitForTimeout(ms);

// This suite turns its own schedule off, so a "schedule" row is someone else's: on a Mac the suites share one Notion page (CI gives each its own), and another session's
// app may be running its schedule into it. Rows by a schedule are ignored here.
// Which of these runs are this app's. A Notion row with no local record may be another app's (CI and a Mac use the same page when a token is shared), so it is ignored,
// unless it is the very same Notion page as one of this app's runs: then the app lists one run twice, which is a bug.
const pageId = url => String(url || '').replace(/-/g, '').match(/[0-9a-f]{32}$/i)?.[0] || '';
function own(runs) {
  const ids = new Set(runs.filter(run => run.log.length && run.notionUrl).map(run => pageId(run.notionUrl)));
  return {mine: runs.filter(run => run.log.length), twice: runs.filter(run => !run.log.length && ids.has(pageId(run.notionUrl)))};
}
// Clicks a task's Run button on the Actions page and waits until its run has ended (nothing running, nothing waiting) -> {fresh: the runs it added, seconds}.
async function runTask(ctx, command, {maxMs = 240000, kind} = {}) {
  const {page} = ctx;
  await page.click('.nav[data-view="actions"]');
  const before = new Set((await runsData(page)).runs.map(run => run.id));
  const started = Date.now();
  await page.click(`[data-command="${command}"]`);
  let data, seen = false;
  while (Date.now() - started < maxMs) {
    await sleep(page, 1500);
    data = await runsData(page);
    const {mine, twice} = own(data.runs.filter(run => !before.has(run.id) && run.trigger !== 'schedule' && (!kind || run.kind === kind)));
    if (twice.length) throw new Error(`the app lists one run twice: its own record and the same Notion page again (${twice.map(run => run.kind).join(', ')})`);
    const added = mine;
    seen = seen || !!data.running || added.length > 0;
    if (seen && !data.running && !data.queued.length && added.length) return {fresh: added, data, shown: await shownWith(page, added[0].id), seconds: Math.round((Date.now() - started) / 1000)};
  }
  throw new Error(`the ${command} task was still ${data?.running ? 'running' : 'not finished'} after ${Math.round(maxMs / 1000)} s`);
}

// Chooses an entry of the open menu with a click event, not a mouse click: Playwright scrolls an element into view first, and any scroll closes the menu (renderer/components.js),
// so on the small window of a CI Mac the item vanished under the click ("element is not visible").
const chooseMenu = (page, text) => page.locator('.ui-menu button', {hasText: text}).dispatchEvent('click');

// Opens a run from the Actions page's Recent runs (the newest row of that kind) and reads what the panel shows a person; then closes it.
async function openRun(ctx, label, {inPanel = false, id, snapAs, situation} = {}) {
  const {page} = ctx;
  await page.click('.nav[data-view="actions"]');
  if (inPanel) {   // an older run: the Actions page lists only the newest five, so find it through the panel's filter
    await openPanel(ctx);
    await page.click('#activity-filter');
    await chooseMenu(page, new RegExp(`^${label}`));
    await sleep(page, 500);
    await page.locator('#activity-recent .recent-row').first().click();
  } else {
    await (id ? page.locator(`#runs-table .runs-row[data-run-id="${id}"]`) : page.locator('#runs-table .runs-row').filter({has: page.locator('b', {hasText: new RegExp(`^${label}$`)})}).first()).click();
  }
  await page.waitForFunction(() => !document.getElementById('activity-panel')?.hidden, null, {timeout: 10000});
  await sleep(page, 1500);   // a run read from Notion fetches its page for the log
  const seen = await page.evaluate(() => {
    const text = id => (document.getElementById(id)?.hidden ? '' : document.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();
    return {title: text('activity-selected'), status: text('activity-status'), warningsTitle: text('activity-warnings-title'), warnings: text('activity-warnings-summary'),
      warningList: text('activity-warnings-list'), result: text('activity-result'), message: text('activity-message'), card: text('activity-card'), log: document.getElementById('log')?.textContent || ''};
  });
  // The nightly UI loop looks at these screenshots (layout checks and the AI review): the states where a UI goes wrong are the failure ones.
  if (snapAs) await snap(ctx, snapAs, {view: 'actions', situation});
  await page.click('#activity-close');
  return seen;
}

// After a (re)launch: the window is up and the app has read its history and has nothing to do.
async function appReady(ctx) {
  await ctx.page.waitForSelector('.view:not([hidden])', {timeout: 60000});
  await quiet(ctx, {forMs: 8000, maxMs: 240000});
}

// The rows of the open Recent activity panel as a person sees them: {kind, what, state}.
const panelRows = page => page.evaluate(() => [...document.querySelectorAll('#activity-recent .recent-row')].map(row => ({kind: row.querySelector('.run-kind')?.textContent || '',
  what: row.querySelector('.run-what')?.textContent?.replace(/\s+/g, ' ').trim() || '', state: row.dataset.state || ''})));
async function openPanel(ctx) {
  const {page} = ctx;
  await page.click('.nav[data-view="actions"]');
  await page.click('#runs-all');
  await page.waitForFunction(() => !document.getElementById('activity-panel')?.hidden, null, {timeout: 10000});
  await sleep(page, 800);
}
// Search rows this app started (a "schedule" row is someone else's, see runTask).
const searchRows = async (page, before) => { const {mine, twice} = own((await runsData(page)).runs.filter(run => run.kind === 'search' && run.trigger !== 'schedule' && !before.has(run.id))); return [...mine, ...twice]; };
const idsNow = async page => new Set((await runsData(page)).runs.map(run => run.id));

// The feed the engine reads: these postings, nothing else (an empty list means a search finds nothing new and asks the AI nothing).
let nextId = Math.floor(Date.now() / 1000);   // new in every run of the suite: a posting seen by an earlier run (its Job Matches row stays in Notion) is not new
function setFeed(ctx, titles = []) {
  // The titles say both "Site Reliability Engineer" and "Data Analyst": the roles a wizard-built page searches for, and the example's (a page whose Search settings were not built from the CV).
  const jobs = titles.map(title => { const id = nextId++; title = `${title} (Site Reliability / Data Analyst)`; return {id, title, location: {name: 'Zurich, Switzerland or Amsterdam, Netherlands'}, absolute_url: `https://boards.e2e.test/job/${id}`, updated_at: '2026-10-02T09:00:00Z',
    content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in Zurich, English working language.</p>`}; });
  fs.writeFileSync(path.join(ctx.feeds, 'acme.json'), JSON.stringify({jobs}));
  fs.writeFileSync(path.join(ctx.feeds, 'beta.json'), JSON.stringify({jobs: []}));
  return jobs;
}

// What a person is told about a run, plus what must be true of every run.
function problemsWith(ctx, run, {label, shown}) {
  const found = [];
  const words = shown?.result ?? '';   // the line on the page, not a field of the data: the page is what a person reads
  const bad = badSummary(words);
  if (bad) found.push(`${label}: the summary line is wrong: ${bad}`);
  const log = run.log.join('\n');
  if (!run.log.length) found.push(`${label}: the Technical log is empty`);
  const secrets = [ctx.key, ctx.token];
  for (const leak of leaks(`${log}\n${words}`, {secrets, dirs: [ctx.profile, ctx.feeds]})) found.push(`${label}: the log or summary shows ${leak}`);
  return found;
}

// No row of this suite's run history may stay "Running" once the app says nothing runs. Waits a little: the engine closes its row a moment after the app sees the end.
async function noRowStaysRunning(ctx, {allow = 0, waitMs = 45000} = {}) {
  const started = Date.now();
  let rows;
  do {
    rows = (await runRows(ctx.token, RUNS_DB)).filter(row => row.status === 'Running' && !/schedule/i.test(row.trigger));
    if (rows.length <= allow) return;
    await sleep(ctx.page, 3000);
  } while (Date.now() - started < waitMs);
  throw new Error(`${rows.length} run row(s) in Notion are still "Running" with nothing running: ${rows.map(row => `"${row.title}" (${row.summary.slice(0, 40)})`).join('; ')}`);
}

// Waits until the app has shown nothing running, nothing queued and its history loaded for `forMs` in a row.
async function quiet(ctx, {forMs, maxMs}) {
  const started = Date.now();
  let since = null, data;
  while (Date.now() - started < maxMs) {
    data = await runsData(ctx.page);
    const idle = !data.running && !data.queued.length && data.historyLoaded;
    since = idle ? since ?? Date.now() : null;
    if (since && Date.now() - since >= forMs) return data;
    await sleep(ctx.page, 2000);
  }
  throw new Error(`the app was still busy after ${Math.round(maxMs / 1000)} s of waiting for quiet: running=${JSON.stringify(data?.running)} queued=${data?.queued.length} historyLoaded=${data?.historyLoaded}`);
}

export async function run(ctx) {
  const {proxy} = ctx;
  // The app is started again in some steps (ctx.relaunch): `page` always means the window of the one running now.
  const page = new Proxy({}, {get: (_, key) => { const value = ctx.page[key]; return typeof value === 'function' ? value.bind(ctx.page) : value; }});
  ctx.findings = [];
  console.log(`  profile ${ctx.profile}, feeds ${ctx.feeds}`);
  await ctx.run('this suite starts with no run rows in its Notion page', async () => {
    console.log(`  cleared ${await emptyDatabase(ctx.token, RUNS_DB)} run row(s)`);
  }, {needs: ctx.needs});
  await ensureSetUp(ctx);
  fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
  fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));
  fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'scout_seeds.json'), path.join(ctx.profile, 'config', 'scout_seeds.json'));
  setFeed(ctx, []);
  await ctx.run('the app is quiet before the first task: no schedule, no first search, its history read', async () => {
    // A set-up install starts its first search by itself, and a schedule catches up what is due: neither belongs in a count of "one click, one row".
    await page.evaluate(() => window.pilot.saveSettings({autoSearch: false, schedule: {search: 0, mail: 0, scout: 'off', insights: 'off'}}));
    await quiet(ctx, {forMs: 20000, maxMs: 300000});
  }, {needs: ctx.needs});

  // ---------- (1) every task card ----------
  const TASKS = [
    {command: 'run', kind: 'search', what: 'Search for new jobs (an empty feed: nothing new)', maxMs: 240000},
    {command: 'scout', kind: 'scout', what: 'Find new employers', maxMs: 240000},
    {command: 'mail', kind: 'mail', what: 'Check Gmail & Calendar with no Google connection', maxMs: 120000},
    {command: 'today', kind: 'today', what: "Send today's matches with no Telegram", maxMs: 120000},
    {command: 'insight', kind: 'insight', what: 'Generate an insight', maxMs: 240000},
    {command: 'weekly', kind: 'weekly', what: 'Create weekly report', maxMs: 240000},
  ];
  ctx.taskRuns = {};
  for (const task of TASKS) {
    await ctx.run(`${task.what}: one Recent runs row, an end, plain words, a clean log, and no row left Running`, async () => {
      const {fresh, shown, seconds} = await runTask(ctx, task.command, {maxMs: task.maxMs, kind: task.kind});
      const mine = shown.find(row => row.id === String(fresh[0].id));
      if (!mine) throw new Error(`the Actions page's Recent runs shows no row for the run that just ended (it shows: ${shown.map(row => row.kind).join(', ')})`);
      const own = fresh.filter(run => run.kind === task.kind);
      console.log(`  ${task.command}: ${fresh.length} row(s) [${fresh.map(run => `${run.kind}:${run.ok ? 'ok' : 'failed'}`).join(', ')}] in ${seconds}s; "${mine?.result.slice(0, 90)}" [${mine?.pill}]`);
      if (own.length !== 1 || fresh.length !== 1) throw new Error(`expected exactly one new Recent runs row of kind ${task.kind}, got ${fresh.length} (${fresh.map(run => `${run.kind} by ${run.trigger} at ${run.startedAt}`).join(', ') || 'none'})`);
      if (process.env.E2E_DEBUG) console.log(JSON.stringify({shown: mine, log: own[0].log.slice(0, 40), ok: own[0].ok, result: own[0].result, summary: own[0].summary}, null, 1));
      const problems = problemsWith(ctx, own[0], {label: task.command, shown: mine});
      if (problems.length) throw new Error(problems.join('; '));
      ctx.taskRuns[task.command] = own[0];
      await noRowStaysRunning(ctx);
    }, {needs: ctx.needs});
  }
  // ---------- (4) Recent activity itself ----------
  // Before the failure tests: the history keeps about the newest 25 runs, and after the tests below the first tasks have scrolled out of it.
  await ctx.run('"View all activity" opens the panel, and its filter keeps one kind of run at a time', async () => {
    await openPanel(ctx);
    const all = await panelRows(page);
    if (!/\d+ recent/.test(await page.textContent('#activity-count'))) throw new Error('the panel does not count its runs');
    // The panel lists a page of the newest runs; the filter menu lists every kind in the whole history, with how many.
    await page.click('#activity-filter');
    const entries = await page.locator('.ui-menu button').allTextContents();
    console.log(`  panel rows: ${all.length}; filter menu: ${entries.join(' | ')}`);
    for (const wanted of [LABEL.search, LABEL.mail, LABEL.today, LABEL.insight, LABEL.weekly, LABEL.scout]) {
      if (!entries.some(entry => entry.replace(/^✓ /, '').startsWith(`${wanted} ·`))) throw new Error(`the filter has no "${wanted}" entry although that task ran`);
    }
    await chooseMenu(page, new RegExp(`^${LABEL.mail}`));
    await sleep(page, 500);
    const mailOnly = await panelRows(page);
    if (!mailOnly.length || mailOnly.some(row => row.kind !== LABEL.mail)) throw new Error(`the Gmail filter shows: ${mailOnly.map(row => row.kind).join(', ') || 'nothing'}`);
    await page.click('#activity-filter');
    await chooseMenu(page, /^(✓ )?All runs/);
    await sleep(page, 500);
    if ((await panelRows(page)).length < all.length) throw new Error('"All runs" did not bring the other runs back');
    await snap(ctx, 'activity-panel', {view: 'actions', situation: 'The Recent activity panel open over the Actions page after many runs'});
    await page.click('#activity-close');
  }, {needs: ctx.needs});

  await ctx.run('opening a finished run shows its result card and its Technical log', async () => {
    const opened = await openRun(ctx, 'Weekly report', {inPanel: true});
    const words = `${opened.message} ${opened.card} ${opened.result}`.trim();
    console.log(`  weekly: result "${words.slice(0, 100)}"; log ${opened.log.split('\n').filter(Boolean).length} line(s)`);
    if (words.length < 20) throw new Error(`the finished weekly report shows no result ("${words}")`);
    if (badSummary(words.slice(0, 200))) throw new Error(`its result is wrong: ${badSummary(words.slice(0, 200))}`);
    if (/^(Nothing to show yet|No log for this run)/.test(opened.log.trim()) || !opened.log.trim()) throw new Error('its Technical log is empty');
  }, {needs: ctx.needs});

  await ctx.run('a run read only from Notion (a fresh start, no local record) still shows its log', async () => {
    await ctx.relaunch({}, profile => fs.rmSync(path.join(profile, 'runs.json'), {force: true}));
    await appReady(ctx);
    const data = await runsData(page);
    if (data.runs.some(run => run.log.length)) throw new Error('the local run record was not removed: this would test nothing');
    if (!data.runs.length) throw new Error('the history read from Notion is empty after a fresh start');
    const opened = await openRun(ctx, 'Weekly report', {inPanel: true});
    const lines = opened.log.split('\n').filter(Boolean).length;
    console.log(`  from Notion: ${data.runs.length} run(s); weekly log ${lines} line(s)`);
    if (/^(Nothing to show yet|No log for this run)/.test(opened.log.trim()) || !lines) throw new Error('a run read from Notion shows no log');
    for (const leak of leaks(opened.log, {secrets: [ctx.key, ctx.token], dirs: [ctx.profile, ctx.feeds]})) throw new Error(`a Notion run's log shows ${leak}`);
  }, {needs: ctx.needs});

  // ---------- (2) the AI fails ----------
  // A search with one new posting: the AI is asked, and the proxy answers the way the real API does when it is in trouble.
  const FAILURES = [
    {mode: 'rate-limit', what: 'the AI answers 429 (rate limit)'},
    {mode: 'server-error', what: 'the AI answers 500'},
    {mode: 'invalid-key', what: 'the AI says the key is invalid (401)'},
    {mode: 'no-credit', what: 'the AI says the credit balance is empty (the spending limit)', limit: true},
  ];
  for (const failure of FAILURES) {
    await ctx.run(`${failure.what}: the run ends as Failed or with warnings, in words, with nothing left Running`, async () => {
      setFeed(ctx, [`Senior Site Reliability Engineer, ${failure.mode}`]);
      proxy.setMode(failure.mode);
      const callsBefore = proxy.stats.calls;
      try {
        const {fresh, shown, seconds} = await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'});
        const mine = shown.find(row => row.id === String(fresh[0].id));
        const run = fresh[0];
        const opened = await openRun(ctx, LABEL.search, {id: fresh[0].id, ...(failure.mode === 'rate-limit' ? {snapAs: 'activity-run-warned', situation: 'A Jobs check that finished with warnings because the AI answered 429 (rate limit): its detail pane in the Recent activity panel'} : {})});
        console.log(`  ${failure.mode}: ${seconds}s, ${proxy.stats.calls - callsBefore} AI call(s); ok=${run.ok} warned=${run.warned}; list: "${mine?.result}" [${mine?.pill}]; panel: [${opened.status}] ${opened.warningsTitle} | ${opened.warnings.slice(0, 160)}`);
        const problems = [];
        if (fresh.length !== 1) problems.push(`${fresh.length} Recent runs rows for one click`);
        if (proxy.stats.calls - callsBefore < 1) problems.push('the AI was never asked, so nothing was tested');
        const bad = badSummary(mine?.result);
        if (bad) problems.push(`the list's words are wrong: ${bad}`);
        if (/Completed$/.test(opened.status) && !opened.warnings && !opened.warningList) problems.push('the run says plain "Completed" with no warning, though the AI refused every call');
        if (/warning/i.test(opened.status) !== /warning/i.test(mine?.pill || '')) problems.push(`the list says "${mine?.pill}" and the panel "${opened.status}"`);
        if (/no line about them/i.test(`${opened.warnings} ${opened.warningList}`)) problems.push('the panel warns but gives no reason ("the run recorded warnings, with no line about them")');
        if (!/Failed|warning|Needs/i.test(`${opened.status} ${mine?.pill}`)) problems.push(`neither the panel ("${opened.status}") nor the list ("${mine?.pill}") says it did not fully work`);
        const shownWords = `${opened.warnings} ${opened.warningList} ${opened.result} ${opened.message} ${mine?.result}`;
        if (/rate_limit_error|api_error|authentication_error|invalid_request_error|\{'type': 'error'|Traceback/.test(shownWords)) problems.push(`raw API words are shown: "${shownWords.slice(0, 120)}"`);
        if (failure.limit && !/spending limit|AI limit/i.test(shownWords)) problems.push(`the spending limit is not named as such: "${shownWords.slice(0, 160)}"`);
        for (const leak of leaks(`${opened.log}\n${shownWords}`, {secrets: [ctx.key, ctx.token], dirs: [ctx.profile, ctx.feeds]})) problems.push(`the log shows ${leak}`);
        if (problems.length) throw new Error(problems.join('; '));
        await noRowStaysRunning(ctx);
      } finally { proxy.setMode('pass'); }
    }, {needs: ctx.needs});
  }
  await ctx.run('an insight paused by the spending limit is a run with a warning that names the limit, not a failure', async () => {
    proxy.setMode('no-credit');
    try {
      const {fresh, shown} = await runTask(ctx, 'insight', {maxMs: 240000, kind: 'insight'});
      const mine = shown.find(row => row.id === String(fresh[0].id));
      const opened = await openRun(ctx, LABEL.insight, {id: fresh[0].id, snapAs: 'activity-limit-paused', situation: 'An insight paused because the Anthropic spending limit was reached: With warnings, naming the limit, in the Recent activity panel'});
      const words = `${opened.warnings} ${opened.warningList} ${mine?.result}`;
      console.log(`  insight at the limit: list "${mine?.result}" [${mine?.pill}]; panel [${opened.status}] ${opened.warnings.slice(0, 120)}`);
      const problems = [];
      if (/failed/i.test(mine?.result || '') || /Failed/.test(mine?.pill || '')) problems.push(`a pause for the spending limit reads as a failure: "${mine?.result}" [${mine?.pill}]`);
      if (!/spending limit|AI limit/i.test(words)) problems.push(`the limit is not named: "${words.slice(0, 160)}"`);
      if (/terminal/i.test(words)) problems.push('the words send an app user to a terminal');
      if (problems.length) throw new Error(problems.join('; '));
      await noRowStaysRunning(ctx);
    } finally { proxy.setMode('pass'); }
  }, {needs: ctx.needs});
  await ctx.run('after the failures, the next Jobs check works again (the AI is back)', async () => {
    setFeed(ctx, ['Staff Platform Engineer, recovery']);
    const callsBefore = proxy.stats.calls;
    const {fresh} = await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'});
    if (fresh.length !== 1 || !fresh[0].ok) throw new Error(`the run after the failures did not end ok (${fresh.length} row(s), ok=${fresh[0]?.ok})`);
    if (proxy.stats.calls - callsBefore < 1) throw new Error('the AI was never asked, so nothing was tested');
    await noRowStaysRunning(ctx);
  }, {needs: ctx.needs});

  await ctx.run('the AI never answers: the run is stopped after its silence limit and ends as Failed, in words, with nothing left Running', async () => {
    // The app stops a run that prints nothing for 15 minutes; this test shortens that to 30 s (JOB_PILOTTO_E2E_IDLE_MS, honoured only in the journey).
    await ctx.relaunch({JOB_PILOTTO_E2E_IDLE_MS: '30000'});
    await appReady(ctx);
    setFeed(ctx, ['Lead Platform Engineer, silence']);
    proxy.setMode('hang');
    try {
      const {fresh, shown, seconds} = await runTask(ctx, 'run', {maxMs: 180000, kind: 'search'});
      const mine = shown.find(row => row.id === String(fresh[0].id));
      const opened = await openRun(ctx, LABEL.search, {id: fresh[0].id, snapAs: 'activity-run-failed', situation: 'A Jobs check stopped by Job Pilotto after the AI went silent: Failed, with its reason, in the Recent activity panel'});
      console.log(`  silence: ${seconds}s; ok=${fresh[0].ok}; list: "${mine?.result}" [${mine?.pill}]; panel: [${opened.status}] ${opened.warnings.slice(0, 160)}`);
      const problems = [];
      if (fresh.length !== 1) problems.push(`${fresh.length} rows for one click: ${fresh.map(run => `[${run.id} ${run.trigger} ${run.where} ok=${run.ok} start=${run.startedAt} notion=${run.notionUrl.slice(-6)} result="${run.result.slice(0, 50)}" log=${run.log.length}]`).join(' ')}`);
      if (fresh[0].ok) problems.push('a run whose AI never answered ended as a success');
      if (seconds > 150) problems.push(`it took ${seconds} s to give up (the limit was 30 s)`);
      const bad = badSummary(mine?.result);
      if (bad) problems.push(`the list's words are wrong: ${bad}`);
      if (!/no output|stopp|did not answer|silen/i.test(`${fresh[0].log.join('\n')} ${fresh[0].result} ${opened.log} ${opened.warnings}`)) problems.push('nothing in the log or the words says the run was stopped for its silence');
      if (problems.length) throw new Error(problems.join('; '));
      await noRowStaysRunning(ctx);
    } finally { proxy.setMode('pass'); }
  }, {needs: ctx.needs});

  // ---------- (3) two things at once, and a quit in the middle ----------
  await ctx.run('Run double-clicked, and asked again from elsewhere while it runs: one row, not two', async () => {
    await ctx.relaunch();
    await appReady(ctx);
    setFeed(ctx, ['Staff Platform Engineer, double']);
    proxy.setDelay(6000);
    try {
      const before = await idsNow(page);
      await page.click('.nav[data-view="actions"]');
      await page.dblclick('[data-command="run"]');
      await sleep(page, 700);
      await page.evaluate(() => { window.pilot.command('run'); });   // the same task asked from another place (Telegram, a shortcut) while it runs
      await sleep(page, 2500);
      const {samples, endedAt} = await watch(page, {every: 1500, maxMs: 240000});
      if (endedAt == null) throw new Error('the task was still running after 4 minutes');
      if (Math.max(...samples.map(s => s.queued)) > 1) throw new Error(`the second click queued ${Math.max(...samples.map(s => s.queued))} copies of the task`);
      await sleep(page, 20000);   // a late duplicate (the run read back from Notion beside the Mac's own record) shows within a poll or two
      const rows = await searchRows(page, before);
      if (rows.length !== 1) throw new Error(`${rows.length} Jobs check rows for one task pressed twice`);
      await noRowStaysRunning(ctx);
    } finally { proxy.setDelay(0); }
  }, {needs: ctx.needs});

  await ctx.run('a Gmail check started while a search runs shows Queued, then runs after it', async () => {
    setFeed(ctx, ['Principal Platform Engineer, queue']);
    proxy.setDelay(8000);
    try {
      const before = await idsNow(page);
      await openPanel(ctx);
      await page.click('.nav[data-view="actions"]');
      await page.click('[data-command="run"]');
      await page.waitForFunction(() => window.pilot.runs().then(data => data.running?.kind === 'search'), null, {timeout: 60000, polling: 1000});
      await page.click('[data-command="mail"]');
      let sawQueued = null, ended = null;
      const started = Date.now();
      while (Date.now() - started < 240000) {
        await sleep(page, 1000);
        const s = await sample(page);
        const rows = await page.evaluate(() => [...document.querySelectorAll('#activity-recent .recent-row')].map(row => ({kind: row.querySelector('.run-kind')?.textContent || '', state: row.dataset.state, what: row.querySelector('.run-what')?.textContent || ''})));
        const waiting = rows.find(row => row.state === 'queued');
        if (!sawQueued && s.queued && waiting) {
          sawQueued = waiting;
          await page.click('#runs-all');   // pressing Run closed the panel: open it so the picture shows the Queued row
          await sleep(page, 800);
          await snap(ctx, 'activity-queued', {view: 'actions', busy: true, situation: 'A Gmail check waiting behind a running Jobs check: its row says Queued and what it waits for, in the Recent activity panel (the search is still running, so its spinner is expected)'});
          await page.click('#activity-close');
        }
        if (!s.running && !s.queued) { ended = s; break; }
      }
      if (!ended) throw new Error('the search and the Gmail check were still not finished after 4 minutes');
      if (!sawQueued) throw new Error('the Gmail check never showed as Queued while the search ran');
      console.log(`  queued row: ${sawQueued.kind} "${sawQueued.what}"`);
      if (sawQueued.kind !== LABEL.mail) throw new Error(`the queued row is "${sawQueued.kind}", not the Gmail check`);
      if (!/starts after/i.test(sawQueued.what)) throw new Error(`the queued row does not say what it waits for: "${sawQueued.what}"`);
      await sleep(page, 5000);
      const data = await runsData(page);
      const fresh = own(data.runs.filter(run => !before.has(run.id) && run.trigger !== 'schedule')).mine;
      const search = fresh.find(run => run.kind === 'search'), mail = fresh.find(run => run.kind === 'mail');
      if (!search || !mail || fresh.length !== 2) throw new Error(`expected one search and one Gmail check, got: ${fresh.map(run => run.kind).join(', ')}`);
      if (Date.parse(mail.startedAt) < Date.parse(search.endedAt) - 2000) throw new Error('the Gmail check started before the search had ended');
      await noRowStaysRunning(ctx);
    } finally { proxy.setDelay(0); }
  }, {needs: ctx.needs});

  await ctx.run('quitting the app in the middle of a run: it is not shown Running for ever, and the app says what became of it', async () => {
    setFeed(ctx, ['Senior Platform Engineer, restart']);
    proxy.setDelay(25000);
    try {
      const before = await idsNow(page);
      await page.click('.nav[data-view="actions"]');
      await page.click('[data-command="run"]');
      await page.waitForFunction(() => window.pilot.runs().then(data => data.running?.kind === 'search'), null, {timeout: 60000, polling: 1000});
      await sleep(page, 3000);
      await ctx.relaunch();   // the app is killed as a crash or a power cut would: nothing gets to tidy up
      await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      // The app picks up what you had started ("Picking up 1 job from before you quit") after about 20 s. Wait until it is idle again.
      await sleep(page, 30000);
      await quiet(ctx, {forMs: 15000, maxMs: 300000});
      const data = await runsData(page);
      const rows = own(data.runs.filter(run => run.kind === 'search' && run.trigger !== 'schedule' && !before.has(run.id))).mine;
      console.log(`  after the quit: running=${JSON.stringify(data.running)}; search rows: ${rows.map(run => `${run.ok ? 'ok' : 'failed'} ${run.startedAt.slice(11, 19)}`).join(', ')}`);
      if (data.running) throw new Error(`the app still says "${data.running.kind}" is running after everything ended (${data.running.step})`);
      if (!rows.length) throw new Error('the interrupted search left no row in Recent runs at all');
      if (!rows.some(run => run.ok)) throw new Error('the search you had started was not picked up again after the restart');
      await noRowStaysRunning(ctx, {waitMs: 90000});
    } finally { proxy.setDelay(0); }
  }, {needs: ctx.needs});

  await ctx.run('the Actions page and Recent runs render without layout problems after every task', async () => {
    await snap(ctx, 'activity-after-tasks', {view: 'actions'});
    finish(ctx);
  }, {needs: ctx.needs});
}

/* global document, window */
// Actions + Recent activity: every task on the Actions page (one row, an end, plain words, a clean log, nothing left Running) and the Recent activity screen itself (filter,
// "View all activity", a finished run's result card, a run read only from Notion). Starts from a set-up install; resets only its own run rows in Notion.
// What goes WRONG (the AI failing, two things at once, a quit in the middle) is the activityfailures suite, in parallel, on its own Notion page.
import fs from 'node:fs';
import path from 'node:path';
import {badSummary, leaks} from '../lib/activity.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {LABEL, appReady, chooseMenu, noRowStaysRunning, openPanel, openRun, own, panelRows, prepare, problemsWith, runTask, runsData, sleep} from '../lib/activity-steps.mjs';

export const minutes = 15;
export const name = 'activity';
// The app reads Notion's run history every 15 s and picks up the jobs of the last session 20 s after launch: both shortened for the journey (never for a user).
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000'};
export async function run(ctx) {
  const page = await prepare(ctx);
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

  await ctx.run('the Actions page and Recent runs render without layout problems after every task', async () => {
    await snap(ctx, 'activity-after-tasks', {view: 'actions'});
    finish(ctx);
  }, {needs: ctx.needs});
}

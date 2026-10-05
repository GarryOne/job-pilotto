/* global document */
// Actions + Recent activity: every task on the Actions page (one row, an end, plain words, a clean log, nothing left Running) and the Recent activity screen itself (filter,
// "View all activity", a finished run's result card, a run read only from Notion). Starts from a set-up install; resets only its own run rows in Notion.
// What goes WRONG (the AI failing, two things at once, a quit in the middle) is the activityfailures suite, in parallel, on its own Notion page.
import fs from 'node:fs';
import path from 'node:path';
import {badSummary, leaks, liveLogProblems} from '../lib/activity.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {LABEL, appReady, chooseMenu, noRowStaysRunning, openPanel, openRun, panelRows, prepare, problemsWith, runTask, runsData, sleep} from '../lib/activity-steps.mjs';

export const minutes = 15;
export const name = 'activity';
// One failed step never hides the rest: the runner records it and goes on (lib/runner.mjs); only the setup steps marked `critical` stop the suite.
export const keepGoing = true;
// The app reads Notion's run history every 15 s and picks up the jobs of the last session 20 s after launch: both shortened for the journey (never for a user).
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};   // this suite breaks things on purpose: its Sentry reports are tagged expected
// The Actions page's answer to the task that just ended: waits for it, reads what form it is in, and gives it the same checks every screen gets (layout, raw text,
// "a carded run shown as text"). Before 5 Oct 2026 the page was checked once, after all tasks, so each result had been replaced by the next one before anyone looked:
// a finished Search analysis showed as raw Telegram text and no check ever saw it.
async function inspectResult(ctx, task) {
  const {page} = ctx;
  await page.waitForFunction(() => ['actions-result', 'command-answer'].some(id => { const box = document.getElementById(id); return box && !box.hidden; }), null, {timeout: 15000}).catch(() => {});
  const shown = await page.evaluate(() => ({card: !!document.querySelector('#actions-result:not([hidden]) #actions-card > *'),
    text: document.getElementById('command-answer')?.hidden ? '' : (document.getElementById('command-answer')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160)}));
  await snap(ctx, `actions-result-${task.command}`, {view: 'actions'});
  return shown;
}

export async function run(ctx) {
  const page = await prepare(ctx);
  // ---------- (1) every task card ----------
  const TASKS = [
    {command: 'run', kind: 'search', what: 'Search for new jobs (an empty feed: nothing new)', maxMs: 240000},
    {command: 'scout', kind: 'scout', what: 'Find new employers', maxMs: 240000},
    {command: 'mail', kind: 'mail', what: 'Check Gmail & Calendar with no Google connection', maxMs: 120000},
    // No scored job in this install: the run has nothing to draft, so it is free and its answer ("Kits ready: 0, no new top match") is exact.
    // Drafting itself (which jobs, the cap, the Notion row) is unit-tested in tests/test_daily.py.
    {command: 'kits', kind: 'kits', what: 'Prepare top matches with no scored job to draft for', maxMs: 120000},
    {command: 'weekly', kind: 'weekly', what: 'Analyze my job search', maxMs: 240000},
  ];
  ctx.taskRuns = {};
  // A seeded run presses the cards in another order (each is checked on its own): a run that only passes after another one, or leaves something behind
  // for the next, shows up. No seed (the release gate) = the order above. Replay: E2E_SEED=<seed> node suite.mjs activity.
  const order = ctx.vary.shuffle(TASKS);
  if (!ctx.vary.fixed) {
    console.log(`  variation: seed ${ctx.vary.seed}; tasks in order ${order.map(task => task.command).join(', ')}`);
    fs.mkdirSync(ctx.ARTIFACTS, {recursive: true});
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), JSON.stringify({seed: ctx.vary.seed, fixed: false, detail: `tasks: ${order.map(task => task.command).join(', ')}`}));
  }
  for (const task of order) {
    await ctx.run(`${task.what}: one Recent runs row, an end, plain words, a clean log, and no row left Running`, async () => {
      const {fresh, shown, seconds, samples} = await runTask(ctx, task.command, {maxMs: task.maxMs, kind: task.kind});
      const mine = shown.find(row => row.id === String(fresh[0].id));
      if (!mine) throw new Error(`the Actions page's Recent runs shows no row for the run that just ended (it shows: ${shown.map(row => row.kind).join(', ')})`);
      const own = fresh.filter(run => run.kind === task.kind);
      console.log(`  ${task.command}: ${fresh.length} row(s) [${fresh.map(run => `${run.kind}:${run.ok ? 'ok' : 'failed'}`).join(', ')}] in ${seconds}s; "${mine?.result.slice(0, 90)}" [${mine?.pill}]`);
      if (own.length !== 1 || fresh.length !== 1) throw new Error(`expected exactly one new Recent runs row of kind ${task.kind}, got ${fresh.length} (${fresh.map(run => `${run.kind} by ${run.trigger} at ${run.startedAt}`).join(', ') || 'none'})`);
      if (process.env.E2E_DEBUG) console.log(JSON.stringify({shown: mine, log: own[0].log.slice(0, 40), ok: own[0].ok, result: own[0].result, summary: own[0].summary}, null, 1));
      const problems = [...problemsWith(ctx, own[0], {label: task.command, shown: mine}), ...liveLogProblems(samples, {label: task.what})];
      if (problems.length) throw new Error(problems.join('; '));
      ctx.taskRuns[task.command] = own[0];
      await noRowStaysRunning(ctx);
      const result = await inspectResult(ctx, task);
      console.log(`  ${task.command}: the Actions page shows ${result.card ? 'a card' : result.text ? `text "${result.text.slice(0, 60)}"` : 'nothing'}`);
      // The report has a card of its own (renderer/pages/activity.js cardFor): the same one Recent activity draws, never the chat message it was written as.
      if (task.command === 'weekly' && !result.card) throw new Error(`the Actions page shows the finished Search analysis as text, not as its card: "${result.text || 'nothing at all'}"`);
    }, {needs: ctx.needs});
  }
  // A task that works for a while must say what it is doing (5 Oct 2026: Find new employers showed "Nothing to show yet" for four minutes). The AI is made slow, so the
  // silence is long enough to see on fixtures: every AI-using task must still show its first line within seconds, and keep showing lines as it goes.
  for (const task of [{command: 'scout', kind: 'scout', what: 'Find new employers'}]) {
    await ctx.run(`${task.what} with a slow AI still streams its live log while it works`, async () => {
      ctx.proxy.setDelay(8000);
      try {
        const {samples, fresh} = await runTask(ctx, task.command, {maxMs: 420000, kind: task.kind});
        const problems = liveLogProblems(samples, {label: task.what, firstWithin: 20000});
        const lines = Math.max(0, ...samples.map(item => item.logShown));
        console.log(`  ${task.command}: ${samples.length} samples while running, up to ${lines} log line(s) shown, ${fresh.length} row(s)`);
        if (lines < 3) problems.push(`its live log never grew past ${lines} line(s) in a run of ${samples.length * 1.5} s: it does not say what it is doing between its first and last line`);
        if (problems.length) throw new Error(problems.join('; '));
      } finally { ctx.proxy.setDelay(0); }
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
    for (const wanted of [LABEL.search, LABEL.mail, LABEL.kits, LABEL.weekly, LABEL.scout]) {
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
    const opened = await openRun(ctx, LABEL.weekly, {inPanel: true});
    const words = `${opened.message} ${opened.card} ${opened.result}`.trim();
    console.log(`  weekly: result "${words.slice(0, 100)}"; log ${opened.log.split('\n').filter(Boolean).length} line(s)`);
    if (words.length < 20) throw new Error(`the finished search analysis shows no result ("${words}")`);
    if (badSummary(words.slice(0, 200))) throw new Error(`its result is wrong: ${badSummary(words.slice(0, 200))}`);
    if (/^(Nothing to show yet|No log for this run)/.test(opened.log.trim()) || !opened.log.trim()) throw new Error('its Technical log is empty');
  }, {needs: ctx.needs});

  await ctx.run('clicking the pop-up of a finished task opens that task\'s result in Recent activity', async () => {
    const {page} = ctx;
    const selected = () => page.evaluate(() => (document.getElementById('activity-selected')?.textContent || '').replace(/\s+/g, ' ').trim());
    await page.click('.nav[data-view="actions"]');
    await page.click('[data-command="kits"]');   // the quick, free task: its pop-up is the news that the run ended (renderer/pages/activity.js announceRuns)
    const popup = page.locator('.toast.toast-link').filter({hasText: new RegExp(LABEL.kits, 'i')}).first();
    await popup.waitFor({timeout: 180000});
    // Look at an older run first and leave the panel open on it: the panel would show the new run by itself (it is the latest), so only the click can switch it.
    await page.locator('#runs-table .runs-row').filter({hasNot: page.locator('b', {hasText: new RegExp(`^${LABEL.kits}$`)})}).first().click();   // the Actions page lists the newest five
    await page.waitForFunction(() => !document.getElementById('activity-panel')?.hidden, null, {timeout: 10000});
    const before = await selected();
    if (!before || new RegExp(LABEL.kits, 'i').test(before)) throw new Error(`the test could not open an older run first (the panel shows "${before}")`);
    await popup.click();   // the pop-up is still on screen: they last 8 s
    await page.waitForFunction(label => (document.getElementById('activity-selected')?.textContent || '').includes(label), LABEL.kits, {timeout: 5000})
      .catch(async () => { throw new Error(`the pop-up opened Recent activity on "${await selected()}", not on the run it announced (${LABEL.kits})`); });
    await page.click('#activity-close');
  }, {needs: ctx.needs});

  // 5 Oct 2026: a run sent to Telegram (--send) leaves no message in this Mac's record; the report lives on its Notion page only.
  // With Always on off, the Search analysis opened to an empty pane. Same record, message stripped: the result must still be drawn.
  await ctx.run('a run recorded on this Mac without its message still shows its result from the Notion page', async () => {
    await ctx.relaunch({}, profile => {
      const file = path.join(profile, 'runs.json');
      const runs = JSON.parse(fs.readFileSync(file, 'utf8')).map(run => ({...run, message: null, report: undefined}));
      fs.writeFileSync(file, JSON.stringify(runs));
    });
    await appReady(ctx);
    const opened = await openRun(ctx, LABEL.weekly, {inPanel: true});
    const words = `${opened.message} ${opened.card} ${opened.result}`.trim();
    if (words.length < 20) throw new Error(`a local run without its message opens to no result ("${words}"): its Notion page is not read`);
    if (!opened.log.trim()) throw new Error('reading the Notion page replaced the run\'s own log with nothing');
  }, {needs: ctx.needs});

  await ctx.run('a run read only from Notion (a fresh start, no local record) still shows its log', async () => {
    await ctx.relaunch({}, profile => fs.rmSync(path.join(profile, 'runs.json'), {force: true}));
    await appReady(ctx);
    const data = await runsData(page);
    if (data.runs.some(run => run.log.length)) throw new Error(`the local run record was not removed: this would test nothing (runs with a log: ${data.runs.filter(run => run.log.length).map(run => `${run.kind || 'search'} by ${run.trigger} at ${run.startedAt}, ${run.log.length} line(s)`).join('; ')})`);
    if (!data.runs.length) throw new Error('the history read from Notion is empty after a fresh start');
    const opened = await openRun(ctx, LABEL.weekly, {inPanel: true});
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

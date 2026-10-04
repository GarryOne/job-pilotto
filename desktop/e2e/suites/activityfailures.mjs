/* global document, window */
// Actions + Recent activity when things go WRONG: the AI answering 429, 500, 401, no credit and never answering; the same task asked twice; a Gmail check queued behind a search;
// quitting the app in the middle of a run. Starts from a set-up install; resets only its own run rows in Notion. The task cards and the Recent activity screen are the
// activity suite, in parallel, on its own Notion page (this split halves the wall-clock time).
import {badSummary, leaks, sample, watch} from '../lib/activity.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {LABEL, appReady, idsNow, noRowStaysRunning, openPanel, openRun, own, prepare, quiet, runTask, runsData, searchRows, setFeed, sleep} from '../lib/activity-steps.mjs';

export const minutes = 20;
export const name = 'activityfailures';
// Notion fails on purpose too (lib/notion-proxy.mjs): busy, an HTML error page, the connection gone.
export const notionProxy = true;
// The app reads Notion's run history every 15 s and picks up the jobs of the last session 20 s after launch: both shortened for the journey (never for a user).
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};   // this suite breaks things on purpose: its Sentry reports are tagged expected
export async function run(ctx) {
  const {proxy} = ctx;
  const page = await prepare(ctx);
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
  await ctx.run('a search analysis paused by the spending limit is a run with a warning that names the limit, not a failure', async () => {
    proxy.setMode('no-credit');
    try {
      const {fresh, shown} = await runTask(ctx, 'weekly', {maxMs: 240000, kind: 'weekly'});
      const mine = shown.find(row => row.id === String(fresh[0].id));
      const opened = await openRun(ctx, LABEL.weekly, {id: fresh[0].id, snapAs: 'activity-limit-paused', situation: 'A search analysis paused because the Anthropic spending limit was reached: With warnings, naming the limit, in the Recent activity panel'});
      const words = `${opened.warnings} ${opened.warningList} ${mine?.result}`;
      console.log(`  search analysis at the limit: list "${mine?.result}" [${mine?.pill}]; panel [${opened.status}] ${opened.warnings.slice(0, 120)}`);
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

  // ---------- (2b) Notion fails (5 Oct 2026) ----------
  // The run's own writes fail the way Notion and networks really do; reads still work, so the panel can show what became of the run. A person must see a clear end,
  // in words: never "Running" for ever, never the HTML of an error page or Notion's JSON.
  const NOTION_FAULTS = [
    {mode: 'rate-limit', times: 3, what: 'Notion is busy (429) for a moment', recovers: true},
    {mode: 'html', writes: true, what: 'Notion answers an HTML error page instead of JSON'},
    {mode: 'offline', writes: true, what: 'the connection to Notion is gone'},
  ];
  for (const fault of NOTION_FAULTS) {
    await ctx.run(`${fault.what} during a Jobs check: the run ends ${fault.recovers ? 'normally' : 'as Failed or with warnings'}, in words, with nothing left Running`, async () => {
      setFeed(ctx, [`Senior Site Reliability Engineer, notion ${fault.mode}`]);
      const failedBefore = ctx.notion.stats.failed;
      ctx.notion.fail(fault.mode, {times: fault.times ?? null, writes: !!fault.writes});
      let finished;
      try { finished = await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'}); } finally { ctx.notion.pass(); }
      const {fresh, shown} = finished;
      const mine = shown.find(row => row.id === String(fresh[0].id));
      const opened = await openRun(ctx, LABEL.search, {id: fresh[0].id, ...(fault.mode === 'html' ? {snapAs: 'activity-notion-html', situation: 'A Jobs check during which Notion answered an HTML error page to every write: its detail pane in the Recent activity panel'} : {})});
      console.log(`  notion ${fault.mode}: ${ctx.notion.stats.failed - failedBefore} call(s) failed; ok=${fresh[0].ok}; list: "${mine?.result}" [${mine?.pill}]; panel: [${opened.status}] ${opened.warnings.slice(0, 160)}`);
      const problems = [];
      if (ctx.notion.stats.failed - failedBefore < 1) problems.push('Notion was never asked while failing, so nothing was tested');
      const words = `${opened.warnings} ${opened.warningList} ${opened.result} ${opened.message} ${mine?.result}`;
      if (/<!DOCTYPE|<html|Bad Gateway<|"object":\s*"error"|rate_limited|internal_server_error|ECONNRE|socket hang up/i.test(words)) problems.push('raw technical text from the failed Notion call is shown to the person');
      const bad = badSummary(mine?.result);
      if (bad) problems.push(`the list's words are wrong: ${bad}`);
      if (!fault.recovers && /Completed$/.test(opened.status) && !opened.warnings && !opened.warningList) problems.push('the run says plain "Completed" though its results never reached Notion');
      if (/warning/i.test(opened.status) !== /warning/i.test(mine?.pill || '')) problems.push(`the list says "${mine?.pill}" and the panel "${opened.status}"`);
      if (problems.length) throw new Error(problems.join('; '));
      await noRowStaysRunning(ctx);
    }, {needs: ctx.needs, faults: true});
  }
  await ctx.run('the AI never answers: the run is stopped after its silence limit and ends as Failed, in words, with nothing left Running', async () => {
    // The app stops a run that prints nothing for 15 minutes; this test shortens that to 10 s (JOB_PILOTTO_E2E_IDLE_MS, honoured only in the journey).
    await ctx.relaunch({JOB_PILOTTO_E2E_IDLE_MS: '10000'});
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

  // ---------- (2b) the AI fails where a person asked for something on the spot (not a run) ----------
  // #94 (3 Oct 2026): with the AI out of credit, "Read my CV PDF" put the API's JSON in the CV card ("400 {"type":"error",…,"request_id":…}"). A failure state is where
  // such text shows, so the card is read here, and photographed: the layout check flags technical text shown to a person, and the AI review sees the page.
  await ctx.run('the AI out of credit while reading the CV: the card says it in words, never the API\'s JSON (#94)', async () => {
    proxy.setMode('no-credit');
    try {
      await page.click('.nav[data-view="settings"]');
      page.once('dialog', dialog => dialog.accept().catch(() => {}));   // "Replace your CV data…?" when a CV was read before
      await page.locator('#cv-import').click({timeout: 30000});
      await page.waitForFunction(() => { const said = document.getElementById('cv-message')?.textContent || ''; return said && !/Reading your CV/.test(said); }, null, {timeout: 180000, polling: 1000});
      const said = (await page.locator('#cv-message').innerText()).trim();
      console.log(`  the CV card says: ${said.slice(0, 160)}`);
      if (/[{}]|"type"|request_id|invalid_request_error|Error code/.test(said)) throw new Error(`the CV card shows the API's raw answer: ${said.slice(0, 200)}`);
      if (!/credit|limit/i.test(said)) throw new Error(`the CV card does not say the AI is out of credit: ${said.slice(0, 200)}`);
      await snap(ctx, 'settings-cv-no-credit', {view: 'settings', situation: 'Read my CV PDF pressed while the AI has no credit'});
    } finally { proxy.setMode('pass'); }
  }, {needs: ctx.needs});

  // ---------- (3) two things at once, and a quit in the middle ----------
  await ctx.run('Run double-clicked, and asked again from elsewhere while it runs: one row, not two', async () => {
    await ctx.relaunch();
    await appReady(ctx);
    setFeed(ctx, ['Staff Platform Engineer, double']);
    proxy.setDelay(4000);
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
      await sleep(page, 6000);   // a late duplicate (the run read back from Notion beside the Mac's own record) shows within a poll or two (the history is read every 3 s here)
      const rows = await searchRows(page, before);
      if (rows.length !== 1) throw new Error(`${rows.length} Jobs check rows for one task pressed twice`);
      await noRowStaysRunning(ctx);
    } finally { proxy.setDelay(0); }
  }, {needs: ctx.needs});

  await ctx.run('a Gmail check started while a search runs shows Queued, then runs after it', async () => {
    setFeed(ctx, ['Principal Platform Engineer, queue']);
    proxy.setDelay(6000);
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
    proxy.setDelay(10000);
    try {
      const before = await idsNow(page);
      await page.click('.nav[data-view="actions"]');
      await page.click('[data-command="run"]');
      await page.waitForFunction(() => window.pilot.runs().then(data => data.running?.kind === 'search'), null, {timeout: 60000, polling: 1000});
      await sleep(page, 3000);
      await ctx.relaunch();   // the app is killed as a crash or a power cut would: nothing gets to tidy up
      await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      // The app picks up what you had started ("Picking up 1 job from before you quit") 3 s after launch here (20 s for a user). Wait for that run to start, then until it is idle again.
      await page.waitForFunction(() => window.pilot.runs().then(data => !!data.running || data.runs.some(run => run.kind === 'search')), null, {timeout: 60000, polling: 1000}).catch(() => {});
      await sleep(page, 4000);
      await quiet(ctx, {forMs: 3000, maxMs: 300000});
      const data = await runsData(page);
      const rows = own(data.runs.filter(run => run.kind === 'search' && run.trigger !== 'schedule' && !before.has(run.id))).mine;
      console.log(`  after the quit: running=${JSON.stringify(data.running)}; search rows: ${rows.map(run => `${run.ok ? 'ok' : 'failed'} ${run.startedAt.slice(11, 19)}`).join(', ')}`);
      if (data.running) throw new Error(`the app still says "${data.running.kind}" is running after everything ended (${data.running.step})`);
      if (!rows.length) throw new Error('the interrupted search left no row in Recent runs at all');
      if (!rows.some(run => run.ok)) throw new Error('the search you had started was not picked up again after the restart');
      await noRowStaysRunning(ctx, {waitMs: 90000});
    } finally { proxy.setDelay(0); }
  }, {needs: ctx.needs});

  await ctx.run('the failure and queued states render without layout problems', async () => {
    finish(ctx);
  }, {needs: ctx.needs});
}

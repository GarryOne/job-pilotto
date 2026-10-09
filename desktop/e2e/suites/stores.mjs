/* global document, window */
// The store setting (docs/superpowers/specs/2026-10-09-store-adapters.md): an app on the SQLite store tracks with no Notion at all, and one with no
// store chosen behaves as before (D7: "trying" still asks to connect). No Notion page and no token: `notion = false`. The steps that need the
// engine's callers on the store (a saved job in the Jobs list, an interview) and "Move my data to Notion" come as those pieces land.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const name = 'stores';
export const notion = false;
export const keepGoing = true;
export const minutes = 6;

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
// One store method on the e2e app's own SQLite store (its profile's data folder, as lib/pipeline-env.js gives the engine), never anyone's data:
// the folder must sit in the temp profile, and no Notion token or app-following reaches the engine.
function storeCall(ctx, entity, method, kwargs) {
  const data = path.join(ctx.profile, 'data');
  if (!path.resolve(data).startsWith(fs.realpathSync(os.tmpdir())) && !path.resolve(data).startsWith(os.tmpdir())) throw new Error(`not a temp profile: ${data}`);
  const env = {PATH: process.env.PATH, HOME: ctx.profile, JOB_PILOTTO_STORE: 'sqlite', JOB_PILOTTO_DATA_DIR: data, JOB_PILOTTO_FOLLOW_APP: '0',
    JOB_PILOTTO_DISABLE: 'mail,notion,telegram,google_jobs'};
  const out = execFileSync('python3', ['-m', 'src.stores', 'call', entity, method, JSON.stringify(kwargs)], {cwd: REPO, env, encoding: 'utf8'});
  const answer = JSON.parse(out.trim().split('\n').pop());   // {result} or {error} (src/stores/__main__.py)
  if (answer.error) throw new Error(`${entity}.${method}: ${answer.error}`);
  return answer.result;
}

const KEY = 'sk-ant-api03-e2e-stores-not-a-real-key-0000000000000000000000000000000000000000000000000000';

export async function run(ctx) {
  const {page} = ctx;
  // Interviews is a view that asks for Notion in "trying" (Focus shows "Get started" there since 396d94e).
  const goInterviews = async () => { await page.click('.nav[data-view="interviews"]'); await page.waitForSelector('.view[data-view="interviews"]:not([hidden])'); };
  const gateShown = () => page.evaluate(() => !!document.querySelector('.view[data-view="interviews"] .notion-gate-host')?.children.length);
  const settle = async () => { await page.reload(); await page.waitForSelector('.view:not([hidden])', {timeout: 60000}); };

  await ctx.run('the app is set up on the SQLite store, with no Notion token', async () => {
    await page.evaluate(async key => {
      await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
      await window.pilot.saveSettings({setupDone: true, wizardStep: 'extras', setupFurthest: 'extras', store: 'sqlite'});
    }, KEY);
    await settle();
    const settings = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'settings.json'), 'utf8'));
    if (settings.store !== 'sqlite') throw new Error(`the setting did not stick: store=${JSON.stringify(settings.store)}`);   // the positive control
  }, {critical: true});

  await ctx.run('Interviews opens without asking to connect Notion', async () => {
    await goInterviews();
    if (await gateShown()) throw new Error('Interviews shows the Notion gate on the SQLite store');
  });

  await ctx.run('a remembered answer is kept in this Mac\'s answers.md', async () => {
    const result = await page.evaluate(() => window.pilot.rememberAnswer('What is your notice period?', 'Three months, negotiable'));
    if (result?.needsNotion) throw new Error(`the app asked for Notion: ${result.text}`);
    if (result && result.ok === false) throw new Error(`rememberAnswer failed: ${result.text || JSON.stringify(result)}`);
    const file = path.join(ctx.profile, 'answers.md');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!text.includes('Three months, negotiable')) throw new Error(`answers.md does not hold the answer (${text.length} characters)`);
  });

  // Jobs → Board and the saved views (renderer/jobs-board-rules.js, pages/jobs-board.js): two applications made on the store, then moved
  // through the board's own menu, as a person would; the stage and its event must be in the store after a reload.
  const today = new Date().toISOString().slice(0, 10);
  const BOARD = {applied: 'https://jobs.example.test/board-applied', saved: 'https://jobs.example.test/board-saved'};
  const goBoard = async () => {
    await page.click('.nav[data-view="jobs"]');
    await page.waitForSelector('.view[data-view="jobs"]:not([hidden])');
    await page.click('[data-mode="board"]');
    await page.waitForSelector('#jobs-board:not([hidden]) .board-column');
  };
  const cardIn = (url, stage) => page.evaluate(({u, s}) => !!document.querySelector(`#jobs-board .board-column[data-stage="${s}"] .board-card[data-url="${u}"]`), {u: url, s: stage});   // Playwright: one argument

  await ctx.run('the board shows the store\'s applications in their stage columns', async () => {
    storeCall(ctx, 'applications', 'create', {job: {url: BOARD.applied, title: 'Board Test Engineer', company: 'Example Board Co', applied_on: today}, stage: 'Applied'});
    storeCall(ctx, 'applications', 'create', {job: {url: BOARD.saved, title: 'Board Saved Engineer', company: 'Example Board Co'}, stage: 'Saved'});
    if (storeCall(ctx, 'applications', 'get', {url: BOARD.applied})?.stage !== 'Applied') throw new Error('the seed did not reach the store');   // the positive control
    await settle();
    await goBoard();
    await page.waitForFunction(u => !!document.querySelector(`#jobs-board .board-card[data-url="${u}"]`), BOARD.applied, {timeout: 30000})
      .catch(() => { throw new Error('the store\'s application is not on the board (the Jobs list does not read the store?)'); });
    const columns = await page.evaluate(() => [...document.querySelectorAll('#jobs-board .board-column')].map(column => column.dataset.stage));
    if (columns.length !== 15 || columns[0] !== 'Recruiter lead' || columns.at(-1) !== 'Dismissed') throw new Error(`columns: ${columns.join(', ')}`);
    if (!await cardIn(BOARD.applied, 'Applied') || !await cardIn(BOARD.saved, 'Saved')) throw new Error('a card is in the wrong column');
  });

  await ctx.run('moving a card to Interviewing writes the stage and its event to the store, and it stays after a reload', async () => {
    await page.click(`#jobs-board .board-card[data-url="${BOARD.applied}"] button`);   // its ⋯ "Move to"
    await page.waitForSelector('.ui-menu');
    await page.evaluate(() => [...document.querySelectorAll('.ui-menu button, .ui-menu [role="menuitem"]')].find(item => item.textContent.trim() === 'Interviewing').click());
    await page.waitForFunction(u => !!document.querySelector(`#jobs-board .board-column[data-stage="Interviewing"] .board-card[data-url="${u}"]`), BOARD.applied, {timeout: 30000})
      .catch(async () => { throw new Error(`the card did not move: ${await page.evaluate(() => document.querySelector('.toast, #toast')?.textContent || 'no message')}`); });
    const row = storeCall(ctx, 'applications', 'get', {url: BOARD.applied});
    if (row?.stage !== 'Interviewing') throw new Error(`the store holds ${row?.stage}`);
    const events = storeCall(ctx, 'events', 'list', {app_id: row.id, kind: 'Interviewing'});
    if (!events?.length) throw new Error('no Interviewing event in the store');
    await settle();
    await goBoard();
    await page.waitForFunction(u => !!document.querySelector(`#jobs-board .board-column[data-stage="Interviewing"] .board-card[data-url="${u}"]`), BOARD.applied, {timeout: 30000})
      .catch(() => { throw new Error('after a reload the card is not in Interviewing'); });
  });

  await ctx.run('a saved view chip narrows the list: Saved shows the saved application only', async () => {
    await page.click('[data-mode="list"]');
    await page.click('#jobs-views [data-view="saved"]');
    const urls = await page.evaluate(() => [...document.querySelectorAll('#jobs-body .job-row')].map(row => row.dataset.url));
    if (urls.length !== 1 || urls[0] !== BOARD.saved) throw new Error(`the Saved view lists ${JSON.stringify(urls)}`);
    await page.click('#jobs-views [data-view="saved"]');   // off again: the next steps see the whole list
  });

  await ctx.run('with no store chosen and no Notion, Interviews still asks to connect (no change for anyone)', async () => {
    await page.evaluate(() => window.pilot.saveSettings({store: null}));
    await settle();
    await goInterviews();
    await page.waitForFunction(() => !!document.querySelector('.view[data-view="interviews"] .notion-gate-host')?.children.length, null, {timeout: 15000})
      .catch(() => { throw new Error('without a store chosen, Interviews no longer shows the Notion gate'); });
  });
}

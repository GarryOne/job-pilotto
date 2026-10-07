// What the shared pool tells a person, in the real window on demo data (7 Oct 2026): the Strategy card "Where people like you get interviews" and its way
// into the Jobs list, the job sources card saying what a source gave people like you, the "Few new jobs" chips after a check, and that every one of
// these recommendations is recorded as shown / taken / dismissed in fixed words (app.log area "advice"; the same event goes to technical reports).
// Its own demo window: no Notion, no AI, no engine run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DESKTOP, launch} from '../lib/app.mjs';

export const name = 'foryou';
export const minutes = 3;
export const light = true;
export const keepGoing = true;

const text = (page, selector) => page.locator(selector).first().innerText().catch(() => '');
const advice = profile => { try { return fs.readFileSync(path.join(profile, 'logs', 'app.log'), 'utf8').split('\n').filter(line => /\badvice\b/.test(line)); } catch { return []; } };
const waitFor = async (check, ms = 5000) => { for (let waited = 0; waited < ms; waited += 200) { if (await check()) return true; await new Promise(done => setTimeout(done, 200)); } return false; };

export async function run(ctx) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-foryou-'));
  for (const file of fs.readdirSync(path.join(DESKTOP, 'demo'))) fs.copyFileSync(path.join(DESKTOP, 'demo', file), path.join(profile, file));
  const demo = JSON.parse(fs.readFileSync(path.join(profile, 'coverage.json'), 'utf8'));
  const first = (demo.coverage || demo).for_you?.[0];
  let session = null, page = null;
  try {
    await ctx.run('the demo window opens on Strategy with the shared pool\'s answer', async () => {
      if (!first) throw new Error('desktop/demo/coverage.json has no for_you employers: the setup did not take');
      session = await launch({profile, env: {JOB_PILOTTO_DEMO: '1'}});
      page = session.page;
      await page.waitForSelector('.nav[data-view=focus]:not([hidden])', {timeout: 30000});
      await page.click('.nav[data-view=strategy]');
      if (!await waitFor(() => page.locator('#strategy-foryou:visible').count().then(n => n > 0), 15000)) throw new Error('the card "Where people like you get interviews" never showed');
    });

    await ctx.run('"Where people like you get interviews" lists employers with their interviews, and was recorded as shown', async () => {
      const chips = await page.locator('#foryou-chips button').allInnerTexts();
      if (!chips.length || !chips[0].startsWith(first.company) || !/\binterviews?\b/.test(chips[0])) throw new Error(`chips: ${JSON.stringify(chips)}`);
      if (!await waitFor(async () => advice(profile).some(line => /shown employer on strategy/.test(line)))) throw new Error(`no "shown employer" in app.log: ${advice(profile).slice(-3).join(' | ')}`);
    });

    await ctx.run('a chip opens the Jobs list searched for that employer, and is recorded as taken', async () => {
      await page.locator('#foryou-chips button').first().click();
      await page.waitForSelector('.nav[data-view=jobs].active, .nav[data-view=jobs][aria-current]', {timeout: 5000}).catch(() => {});
      const query = await page.inputValue('#filter-text').catch(() => '');
      if (query !== first.company) throw new Error(`the Jobs search holds "${query}", not "${first.company}"`);
      if (!await waitFor(async () => advice(profile).some(line => /taken employer on strategy/.test(line)))) throw new Error('no "taken employer" in app.log');
      await page.fill('#filter-text', '');
      await page.dispatchEvent('#filter-text', 'input');
    });

    await ctx.run('the job sources card says what a source gave people like you', async () => {
      await page.click('.nav[data-view=strategy]');
      await page.waitForSelector('#strategy-sources:visible', {timeout: 10000});
      const chips = await page.locator('#sources-chips button').allInnerTexts();
      if (!chips.some(chip => /in 10 people like you/.test(chip))) throw new Error(`no "people like you" in ${JSON.stringify(chips)}`);
    });

    await ctx.run('"Not now" hides the employers card, records it, and it stays hidden on the next visit', async () => {
      await page.click('#foryou-dismiss');
      if (await page.locator('#strategy-foryou:visible').count()) throw new Error('still shown after "Not now"');
      if (!await waitFor(async () => advice(profile).some(line => /dismissed employer on strategy/.test(line)))) throw new Error('no "dismissed employer" in app.log');
      await page.click('.nav[data-view=focus]');
      await page.click('.nav[data-view=strategy]');
      await page.waitForTimeout(1500);
      if (await page.locator('#strategy-foryou:visible').count()) throw new Error('back after leaving and coming back');
    });

    await ctx.run('a jobs check with few new jobs offers the same advice as chips, recorded as shown', async () => {
      await page.evaluate(async () => { (await import('./pages/activity.js')).openActivity(true); });
      for (let i = 0; i < 10 && await page.locator('#activity-all:visible').count(); i++) await page.click('#activity-all');
      const rows = page.locator('#activity-recent li:not(.recent-group) button');
      let found = false;
      for (let i = 0; i < await rows.count() && !found; i++) {
        await rows.nth(i).click();
        found = await waitFor(() => page.locator('.run-card-help:visible').count().then(n => n > 0), 1500);
      }
      if (!found) throw new Error('no run shows the "Few new jobs" box (the demo has a check with 0 new jobs)');
      if (!await waitFor(() => page.locator('.run-card-help .coverage-chip').count().then(n => n > 0), 8000)) throw new Error(`no chips: "${(await text(page, '.run-card-help')).slice(0, 200)}"`);
      if (!await waitFor(async () => advice(profile).some(line => /shown \w+ on few-jobs/.test(line)))) throw new Error('no "shown … on few-jobs" in app.log');
    });

    await ctx.run('what is recorded holds fixed words only: never a role word, a place or an employer\'s name', async () => {
      const lines = advice(profile);
      if (!lines.length) throw new Error('nothing recorded');
      const leaked = lines.filter(line => line.includes(first.company) || /Gen[eè]v|Zurich|photograph/i.test(line));
      if (leaked.length) throw new Error(`free words in: ${leaked.join(' | ')}`);
      const odd = lines.filter(line => !/(shown|taken|dismissed) (role|place|filter|source|explain|employer|visit) on (strategy|few-jobs)/.test(line));
      if (odd.length) throw new Error(`not in the fixed shape: ${odd.join(' | ')}`);
    });
  } finally {
    await session?.app.close().catch(() => {});
    fs.rmSync(profile, {recursive: true, force: true});
  }
}

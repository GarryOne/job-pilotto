/* global window, document, location */
// The LIVE run of the apply flow (8 Oct 2026): the real extension in a visible Chrome, on a REAL posting from this Mac's job list (read-only), pressed
// through the app's own Apply, watched for a while, and reported as a timeline. Nothing is pressed on the page: no account button, never Submit.
// The app under test is the e2e one (its own profile and Notion test page, never the owner's data). Run: `npm run live` in desktop/ (LIVE_URL=<posting> to
// pick one; LIVE_SECONDS=120 how long to watch). Not part of the matrix: it needs the real internet and the real site's mood. Guard: desktop/test/apply-live.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {appLogLines} from './app-log.mjs';
import {fillState} from './extension.mjs';
import {removeJobsByUrl} from './notion.mjs';
import {modelClient} from './model.mjs';
import {pause} from './apply-fixtures.mjs';
export {livePosting} from './live-posting.mjs';


// The page-kind question of the live run, answered by a real model (the same request the app's own AI would send): the live run tests what the AI decides.
export async function realKind(body, client = modelClient()) {
  const answer = await client.messages.create(body);
  return answer.content?.find(block => block.type === 'text')?.text ?? null;
}

// Nothing changed for a while: what the page still asks (visible controls: type, label, required, filled) and what the panel says, so a stall is understood, not guessed.
export async function stallReport(tab, say) {
  const view = await tab.evaluate(() => ({url: location.href.split('#')[0].slice(0, 90), title: document.title.slice(0, 60),
    controls: [...document.querySelectorAll('input, select, textarea')].filter(el => el.getClientRects().length && !['hidden', 'submit', 'button'].includes(el.type)).map(el => {
      const label = (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      return `${el.type}·${label}${el.required || el.getAttribute('aria-required') === 'true' ? '·required' : ''}${(el.type === 'checkbox' ? el.checked : el.value) ? '·filled' : '·EMPTY'}`;
    }),
    buttons: [...document.querySelectorAll('button, input[type=submit], a')].filter(el => el.getClientRects().length).map(el => (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean).slice(0, 12),
    panel: document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.card')?.innerText?.replace(/\s+/g, ' ').slice(0, 260) || ''})).catch(error => ({error: String(error).slice(0, 80)}));
  say(`  live STALL (20 s without a change): ${JSON.stringify(view)}`);
}

export async function runLive(ctx, h) {
  const {page, posting, NOTION} = h;
  await ctx.run('a real posting, watched live: the page kinds, stages and fills as they happen (nothing is pressed on the page)', async () => {
    try {
      const frames = path.join(ctx.ARTIFACTS, 'live-frames');
      fs.rmSync(frames, {recursive: true, force: true}); fs.mkdirSync(frames, {recursive: true});
      const seconds = Number(process.env.LIVE_SECONDS) || 120, started = Date.now(), seen = {lines: appLogLines(ctx.profile).length};
      const at = () => `+${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s`;
      await page.click('.nav[data-view="jobs"]');
      await page.evaluate(job => window.pilot.applyOne(job.url, {title: job.title, company: job.company, location: '', workMode: ''}), posting);
      console.log(`  live ${at()}: Apply pressed on ${posting.url}`);
      const sessionStage = async () => (await page.evaluate(() => window.pilot.sessions()).catch(() => [])).find(item => String(item.url || '').replace(/\/$/, '') === posting.url.replace(/\/$/, ''));
      let last = '', changedAt = Date.now(), stalled = false, frame = 0;
      while (Date.now() - started < seconds * 1000) {
        const tabs = ctx.browser.context.pages().filter(tab => /^https?:/.test(tab.url()));
        const states = await Promise.all(tabs.map(async tab => `${tab.url().split('#')[0].slice(0, 70)} [${(await fillState(tab).catch(() => null))?.state || '-'}]`));
        const session = await sessionStage();
        const now = JSON.stringify({states, stage: session?.stage || '-', status: session?.status || '-'});
        if (now !== last) { console.log(`  live ${at()}: session ${session?.stage || '-'}/${session?.status || '-'}; ${states.join(' | ') || 'no tab'}`); last = now; changedAt = Date.now(); stalled = false; }
        // The app's own lines, as they arrive (what the extension decided and why).
        const all = appLogLines(ctx.profile);
        for (const line of all.slice(seen.lines).filter(item => /\[(extension|review)\]/.test(item))) console.log(`      log ${line.slice(11, 230)}`);
        seen.lines = all.length;
        // A picture of every tab every 3 s (the newest is what a person sees now), named so they sort in time.
        if (frame++ % 2 === 0) for (const [index, tab] of tabs.entries()) await tab.screenshot({path: path.join(frames, `${String(frame).padStart(3, '0')}-tab${index}.png`)}).catch(() => {});
        if (!stalled && Date.now() - changedAt > 20000) { stalled = true; await stallReport(tabs.at(-1), console.log); }
        await pause(1500);
      }
      console.log(`  live ${at()}: watched ${seconds}s; frames in ${frames}`);
      if (!ctx.browser.opened.length) throw new Error('Apply never opened the posting in the browser');
    } finally {   // the shared Notion page of this suite must not keep the live job (a stray "Applying" row broke another run's step, 8 Oct 2026)
      console.log(`  live: removed ${await removeJobsByUrl(NOTION, [posting.url]).catch(() => 0)} job row(s) of the live posting`);
    }
  }, {needs: ctx.needs});
}

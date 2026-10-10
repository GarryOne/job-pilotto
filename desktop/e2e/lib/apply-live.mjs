/* global window, document, location, Event, chrome */
// The LIVE run of the apply flow (8 Oct 2026): the real extension in a visible Chrome, on a REAL posting from this Mac's job list (read-only), pressed
// through the app's own Apply, watched for a while, and reported as a timeline. Nothing is pressed on the page: no account button, never Submit.
// The app under test is the e2e one (its own profile and Notion test page, never the owner's data). Run: `npm run live` in desktop/ (LIVE_URL=<posting> to
// pick one; LIVE_SECONDS=120 how long to watch). Not part of the matrix: it needs the real internet and the real site's mood. Guard: desktop/test/apply-live.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appLogLines} from './app-log.mjs';
import {fillState} from './extension.mjs';
import {fieldLines} from './smoke.mjs';
import {appProfileTexts, personalValues, scrub, snapshotInPage} from './capture-page.mjs';
import {removeJobsByUrl} from './notion.mjs';
import {modelClient} from './model.mjs';
import {pause} from './apply-fixtures.mjs';
export {livePosting} from './live-posting.mjs';


// The page-kind question of the live run, answered by a real model (the same request the app's own AI would send): the live run tests what the AI decides.
// Remembered on disk by a hash of the request (a page sketch has no typed value), so a repeat run on the same pages does not wait for the model again: LIVE_FRESH=1 asks anew.
const MEMO = path.join(os.tmpdir(), 'jp-live-ai-memo.json');
export async function realKind(body, client = modelClient({engine: () => 'cli'}), memo = MEMO) {   // the engine is fixed: `claude --version` before every call was slow and flaky
  const key = crypto.createHash('sha256').update(JSON.stringify([body.model, body.system, body.messages, body.output_config])).digest('hex');
  let kept = {};
  try { kept = JSON.parse(fs.readFileSync(memo, 'utf8')); } catch { /* none yet */ }
  if (kept[key] && !process.env.LIVE_FRESH) return kept[key];
  const answer = await client.messages.create(body);
  const text = answer.content?.find(block => block.type === 'text')?.text ?? null;
  if (text) { kept[key] = text; try { fs.writeFileSync(memo, JSON.stringify(kept)); } catch { /* the memo is only a speed-up */ } }
  return text;
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
  say(`  live STALL (12 s without a change; held by the test: ${process.env.LIVE_SUBMIT ? 'no' : 'YES, nothing is pressed'}): ${JSON.stringify(view)}`);
}

// LIVE_PERSON=1: the test plays the person for what the extension must leave to one (a choice it has no detail for): every empty required drop-down gets the option
// that matches LIVE_CHOICE (default: the first real option). Never a consent, never the account button: those are the extension's floors, not the test's.
export async function actAsPerson(tab, say) {
  const wanted = process.env.LIVE_CHOICE || '';
  const done = await tab.evaluate(choice => {
    const picked = [];
    for (const select of document.querySelectorAll('select')) {
      if (!select.getClientRects().length || select.disabled || select.value) continue;
      if (!(select.required || select.getAttribute('aria-required') === 'true' || select.closest('tr, div')?.innerText.includes('*'))) continue;
      const options = [...select.options].filter(option => option.value);
      const option = options.find(item => choice && item.text.toLowerCase().includes(choice.toLowerCase())) || options[0];
      if (!option) continue;
      select.value = option.value; select.dispatchEvent(new Event('input', {bubbles: true})); select.dispatchEvent(new Event('change', {bubbles: true}));
      picked.push(option.text.trim().slice(0, 30));
    }
    return picked;
  }, wanted).catch(() => []);
  say(`  live person: chose ${JSON.stringify(done)}`);
  // The consent and the account button are the extension's, by the setting settings.accountAutomation ('full' by default; LIVE_ASSIST=1 tests 'assist': the person's part is then yours).
}

// Asks the extension's worker for one closer look (extension/ladder/rung4-picture.js) at this tab, as it would on an unclear account page: the picture, the app's answer, one action.
export async function lookViaWorker(ctx, tab, say) {
  await tab.bringToFront().catch(() => {});
  const worker = await ctx.browser.serviceWorker();
  const url = tab.url().split('#')[0];
  const action = await worker.evaluate(async address => {
    const tabs = await chrome.tabs.query({}), found = tabs.find(item => String(item.url).startsWith(address));
    const decided = await globalThis.__jobPilottoCloserLook(found, 0, 'the live test asked for a closer look');
    return `${decided} (tabs: ${JSON.stringify(tabs.map(item => [item.id, item.active, item.windowId, String(item.url).slice(0, 30)]))})`;   // set by extension/ladder/rung4-picture.js
  }, url).catch(error => `error: ${String(error).slice(0, 100)}`);
  say(`  live look: the closer look decided ${JSON.stringify(action)}`);
}

export async function runLive(ctx, h) {
  const {page, posting, NOTION} = h;
  await ctx.run('a real posting, watched live: the page kinds, stages and fills as they happen (nothing is pressed on the page)', async () => {
    try {
      const frames = path.join(ctx.ARTIFACTS, 'live-frames');
      fs.rmSync(frames, {recursive: true, force: true}); fs.mkdirSync(frames, {recursive: true});
      const seconds = Number(process.env.LIVE_SECONDS) || 120, started = Date.now(), seen = {lines: appLogLines(ctx.profile).length};
      const at = () => `+${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s`;
        // LIVE_HAVE_ACCOUNT=1: the app already has an account for LIVE_EMAIL on the account host (as a confirmed sign-up would have left it): the flow must go to sign-in, never sign-up.
      if (process.env.LIVE_HAVE_ACCOUNT) await page.evaluate(([host, email]) => window.pilot.saveSettings({siteAccounts: {[host]: {email: email.toLowerCase(), state: 'confirmed', at: new Date().toISOString()}}}),
        [process.env.LIVE_ACCOUNT_HOST || 'career2.successfactors.eu', process.env.LIVE_EMAIL || 'live@example.com']);
      if (process.env.LIVE_ESCALATION) await page.evaluate(() => window.pilot.saveSettings({escalation: 'on'}));   // the closer look is opt-in: this run turns it on
      console.log(`  live: this run ${process.env.LIVE_SUBMIT ? 'WILL press the consent and the account button on the real site' : 'is HELD: the extension will NOT accept the consent or press the account button (LIVE_SUBMIT=1 lets it)'}; watching ${seconds}s`);
      await page.click('.nav[data-view="jobs"]');
      await page.evaluate(job => window.pilot.applyOne(job.url, {title: job.title, company: job.company, location: '', workMode: ''}), posting);
      console.log(`  live ${at()}: Apply pressed on ${posting.url}`);
      const sessionStage = async () => (await page.evaluate(() => window.pilot.sessions()).catch(() => [])).find(item => String(item.url || '').replace(/\/$/, '') === posting.url.replace(/\/$/, ''));
      let last = '', changedAt = Date.now(), stalled = false, frame = 0, acts = 0, looked = false, lastLine = '';
      while (Date.now() - started < seconds * 1000) {
        const tabs = ctx.browser.context.pages().filter(tab => /^https?:/.test(tab.url()));
        const states = await Promise.all(tabs.map(async tab => `${tab.url().split('#')[0].slice(0, 70)} [${(await fillState(tab).catch(() => null))?.state || '-'}]`));
        const session = await sessionStage();
        const now = JSON.stringify({states, stage: session?.stage || '-', status: session?.status || '-'});
        if (now !== last) { console.log(`  live ${at()}: session ${session?.stage || '-'}/${session?.status || '-'}; ${states.join(' | ') || 'no tab'}`); last = now; changedAt = Date.now(); stalled = false; }
        // The app's own lines, as they arrive (what the extension decided and why).
        const all = appLogLines(ctx.profile);
        for (const line of all.slice(seen.lines).filter(item => /\[(extension|review)\]/.test(item))) { const shown = line.slice(11, 230), same = shown.replace(/^\S+ /, ''); if (same !== lastLine) console.log(`      log ${shown}`); lastLine = same; }   // a repeated line is said once
        // The fill's field list, whole, one line a field (lib/smoke.mjs fieldLines); parseLive reads them.
        for (const line of all.slice(seen.lines)) for (const text of fieldLines(line)) console.log(text);
        seen.lines = all.length;
        // A picture of every tab every 3 s (the newest is what a person sees now), named so they sort in time.
        if (frame++ % 2 === 0) for (const [index, tab] of tabs.entries()) await tab.screenshot({path: path.join(frames, `${String(frame).padStart(3, '0')}-tab${index}.png`)}).catch(() => {});
        if (!stalled && Date.now() - changedAt > 12000) {
          stalled = true; await stallReport(tabs.at(-1), console.log);
          if (process.env.LIVE_LOOK && !looked) { looked = true; await lookViaWorker(ctx, tabs.at(-1), console.log); }   // LIVE_LOOK=1: one closer look at the first stall, as the extension would take it
          if (process.env.LIVE_PERSON && ++acts <= 5) { await actAsPerson(tabs.at(-1), console.log); changedAt = Date.now(); stalled = false; }   // the person acts again after each pause: a choice, then a consent
        }
        await pause(1500);
      }
      console.log(`  live ${at()}: watched ${seconds}s; frames in ${frames}`);
      // LIVE_CAPTURE_DIR: the last page of the run, structure only and scrubbed (lib/capture-page.mjs), for a replay candidate (lib/replay-candidate.mjs): the nightly smoke keeps it only when the run failed.
      if (process.env.LIVE_CAPTURE_DIR) {
        const last = ctx.browser.context.pages().filter(item => /^https?:/.test(item.url())).at(-1), html = last ? await last.evaluate(snapshotInPage).catch(() => '') : '';
        if (html) { fs.mkdirSync(process.env.LIVE_CAPTURE_DIR, {recursive: true}); fs.writeFileSync(path.join(process.env.LIVE_CAPTURE_DIR, 'page.html'), scrub(html, personalValues(appProfileTexts([ctx.profile])))); console.log(`  live: the page is kept for a replay candidate (${html.length} characters, structure only)`); }
      }
      if (!ctx.browser.opened.length) throw new Error('Apply never opened the posting in the browser');
    } finally {   // the shared Notion page of this suite must not keep the live job (a stray "Applying" row broke another run's step, 8 Oct 2026)
      console.log(`  live: removed ${await removeJobsByUrl(NOTION, [posting.url]).catch(() => 0)} job row(s) of the live posting`);
    }
  }, {needs: ctx.needs});
}

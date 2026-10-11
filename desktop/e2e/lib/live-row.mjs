// A live row without Electron (speed-5x landing 3): the app's own server and functions under plain node (lib/offline-app.mjs: the fake applicant, its network cut to
// this computer; the AI asked through the plan's claude -p when `ask`), the real extension in a test browser that reaches the real site, and the harness doing
// what the window would: save the applicant's contact, press Apply (the app hands the posting's address to this browser), then watch. Nothing is pressed on the
// page by the harness, never Submit. Every page is captured as the Electron run captures it (lib/capture-journey.mjs, at the extension's ask), and the privacy
// tripwire (lib/privacy-tripwire.mjs) checks every field every few seconds and before anything is written. -> {seconds, opened, evidence, tripped}.
// CLI: live-row.mjs. Guard: e2e/test/live-row.test.mjs (a fake site, memo-only).
/* global document, location */
import fs from 'node:fs';
import {ensureStagedWorker} from './staged-worker.mjs';
import path from 'node:path';
import {frontOf} from './app-front.mjs';
import {seedVersion} from './applicant-seed.mjs';
import {CONTACT} from './apply-fixtures.mjs';
import {cssRecorder, personalValues, scrub} from './capture-page.mjs';
import {journeyRecorder} from './capture-journey.mjs';
import {evidenceLines} from './evidence-bundle.mjs';
import {PAGE_LINE, STILL_SECONDS, stillClock} from './live-still.mjs';
import {startOfflineApp} from './offline-app.mjs';
import {ownerValues, pageFields, tripwire} from './privacy-tripwire.mjs';
import {applyPoolEligibility} from './pool-eligibility.mjs';
import {seedLivePosting} from './seed-data.mjs';
import {storeCall} from './store-call.mjs';
import {startRealExtension} from './real-extension.mjs';
import {livePresses} from './replay-candidate.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// posting: {url, title, company}; captureDir: where the journey, the AI calls and the asks go; ask: false keeps the AI to kept answers (a test), true asks live.
export async function runLiveRow({posting, captureDir, extensionDir, ask = true, seconds = 120, stillSeconds = STILL_SECONDS, browser = startRealExtension, say = () => {}} = {}) {
  ensureStagedWorker({say});   // a worker edit since the last staging would run the old prompt
  const started = Date.now();
  fs.mkdirSync(captureDir, {recursive: true});
  const app = await startOfflineApp({ask, captureDir, memo: path.join(captureDir, 'model-memo.json')});
  const front = await frontOf(app);
  const run = await browser({extensionDir, appPort: front.port, allowAllSites: true});
  const owner = ownerValues(), values = personalValues([`Name: ${CONTACT.full_name}\nEmail: ${CONTACT.email}\nPhone: ${CONTACT.phone}`]);
  const journey = journeyRecorder(run.context, {scrub: html => scrub(html, values)}), styles = cssRecorder(run.context);
  let asksSeen = 0, tripped = '';
  const asks = setInterval(() => {   // each ask noted by the app as it arrives (asks.jsonl): that page kept at once, as the extension saw it
    let lines = [];
    try { lines = fs.readFileSync(path.join(captureDir, 'asks.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return; }
    for (const line of lines.slice(asksSeen)) { try { journey.atAsk(JSON.parse(line).url).catch(() => {}); } catch { /* a line being written */ } }
    asksSeen = lines.length;
  }, 200);
  const trip = async () => {
    for (const tab of run.context.pages().filter(page => /^https?:/.test(page.url()))) {
      const check = await tripwire(pageFields(tab), {values: owner, saved: [captureDir]});
      if (!check.ok) return check.reason;
    }
    return '';
  };
  try {
    await applyPoolEligibility(run.context.serviceWorkers()[0] || await run.context.waitForEvent('serviceworker', {timeout: 30000}), {say});   // before Apply: a pool run measures filling
    await app.call('saveContact', CONTACT);
    // The posting as the Electron path has it (suites/apply.mjs): tracked, Saved, no kit, in this app's own store (lib/seed-data.mjs seedLivePosting).
    const store = {store: 'sqlite', profile: app.dir};
    await seedLivePosting({...store, data: (entity, method, kwargs) => storeCall(store, entity, method, kwargs)}, posting);
    const opened = new Promise((resolve, reject) => { app.onOpen(resolve); setTimeout(() => reject(new Error('Apply never opened the posting')), 15000).unref(); });
    const applied = await app.call('applyOne', posting.url, {title: posting.title || '', company: posting.company || ''});
    if (!applied?.ok) throw new Error(`Apply failed: ${applied?.error || 'no answer'}`);
    const url = await opened;
    say(`live: Apply opened ${url.split('#')[0]}`);
    // As the Electron run's browser: one tab, the headless window's own size (lib/extension.mjs viewport null: 1200 x 818). A page laid out at another width
    // showed its dialog's buttons otherwise, and the AI judged it otherwise (11 Oct 2026, jobs.ch: "account" here, "posting" there).
    for (const page of run.context.pages()) if (page !== run.page && !page.url().startsWith('chrome-extension://')) await page.close().catch(() => {});
    await run.page.setViewportSize({width: 1200, height: 818}).catch(() => {});
    await run.page.goto(url, {waitUntil: 'domcontentloaded'}).catch(() => {});
    const clock = stillClock({seconds: stillSeconds, startedAt: Date.now()});
    for (let turn = 0; Date.now() - started < seconds * 1000; turn++) {
      const lines = app.logText().split('\n').filter(line => PAGE_LINE.test(line)).length;
      // Still = the page and its decisions stopped changing (as lib/apply-live.mjs: the extension's own check-ins to the app every few seconds are no news).
      const shape = await run.context.pages().filter(page => /^https?:/.test(page.url())).at(-1)?.evaluate(() => `${location.href.split('#')[0]}|${document.querySelectorAll('input, select, textarea, button, a').length}`).catch(() => '');
      clock.see(JSON.stringify([lines, shape]), Date.now());
      if (clock.over(Date.now(), {opened: true})) break;
      await journey.tick();
      if (turn % 4 === 0 && (tripped = await trip())) break;
      await wait(1500);
    }
    clearInterval(asks);
    if (tripped || (tripped = await trip())) { say(`live: ${tripped}`); return {seconds: (Date.now() - started) / 1000, opened: url, evidence: evidenceLines(''), tripped}; }
    await journey.finish();
    const pages = journey.write(captureDir);
    // The capture is a row a replay can start from (npm run row -- <captureDir>): its pages and the live presses, as the pool keeps them (lib/replay-candidate.mjs).
    fs.writeFileSync(path.join(captureDir, 'case.json'), `${JSON.stringify({shape: posting.title || posting.url, pages, seed: seedVersion()}, null, 1)}\n`);
    fs.writeFileSync(path.join(captureDir, 'presses.json'), `${JSON.stringify(livePresses(app.logText()), null, 1)}\n`);
    fs.writeFileSync(path.join(captureDir, 'styles.har.json'), JSON.stringify(await styles.har()));
    fs.writeFileSync(path.join(captureDir, 'app.log'), app.logText());
    return {seconds: Math.round((Date.now() - started) / 100) / 10, opened: url, evidence: evidenceLines(app.logText()), tripped: '', requests: front.requests.length, appLog: app.logText()};
  } finally {
    clearInterval(asks);
    await run.close().catch(() => {});
    await front.close().catch(() => {});
    await app.close().catch(() => {});
  }
}

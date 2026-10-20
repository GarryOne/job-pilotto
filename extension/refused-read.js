// "Read refused sites in my browser" (owner, 19 Oct 2026; rule: CLAUDE.md, the opt-in exception to "never past a login wall"): once an hour the extension asks the app what is
// due. The app answers unless the person turned the setting off (Settings → Advanced, on by default since 20 Oct 2026), and then lists sites that refused the app's own reading and were not
// asked in the last 30 days. Each is fetched ONCE, one at a time, with a pause, WITHOUT cookies or logins (credentials omitted), and the page goes to the app, which keeps its jobs
// or the stop. Never LinkedIn, Indeed, Glassdoor, levels.fyi, Reddit (checked here too, whatever the app says); a refusal, bot check or login page is the app's stop, never retried and
// never solved. Not a flow file: nothing here touches an application. Guard: desktop/test/extension-refused-read.test.js.
import {api, settings} from './flow.js';
import {ALL_SITES} from './site-allow.js';

export const ALARM = 'refused-reads';
export const NOW_ALARM = 'refused-reads-now';   // every minute: has the app a Read now waiting? (one cheap call, the engine is not asked)
export const PERIOD_MIN = 60;
export const PAUSE_MS = [5000, 12000];   // between sites: gentle, one at a time
export const MAX_SITES = 12;             // the app's own cap, kept here too
export const MAX_BYTES = 3_000_000;
const NEVER = ['linkedin.', 'indeed.', 'glassdoor.', 'levels.fyi', 'reddit.', 'xing.'];   // login-wall sites: only through the person's own visit

export function mayFetch(url) {
  let parts;
  try { parts = new URL(url); } catch { return false; }
  return parts.protocol === 'https:' && !NEVER.some(word => `${parts.hostname.toLowerCase()}.`.includes(word));
}
const titleOf = html => (/<title[^>]*>([^<]{0,300})/i.exec(html) || [])[1]?.trim() || '';
const wait = ms => new Promise(done => setTimeout(done, ms));
let running = false;

// One pass. Everything the browser does is injected so a test can run it without Chrome.
export async function pass({chrome = globalThis.chrome, call = api, config = null, fetchPage = fetch, pause = () => wait(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]))} = {}) {
  if (running) return {read: 0, skipped: 'running'};
  running = true;
  try {
    const cfg = config || await settings();
    const allowed = await chrome.permissions.contains(ALL_SITES);
    const asked = await call(cfg, '/extension/refused-queue', {method: 'POST', body: JSON.stringify({allowed})}).catch(() => null);
    const sites = allowed && asked?.on ? (asked.sites || []).slice(0, MAX_SITES) : [];
    let read = 0;
    for (const [index, site] of sites.entries()) {
      if (index) await pause();
      if (!mayFetch(site.url)) { await call(cfg, '/extension/refused-outcome', {method: 'POST', body: JSON.stringify({url: site.url, status: 0, html: ''})}).catch(() => null); continue; }
      let page = {url: site.url, status: 0, html: '', final: ''};
      try {
        const response = await fetchPage(site.url, {credentials: 'omit', redirect: 'follow', cache: 'no-store'});
        const html = (await response.text()).slice(0, MAX_BYTES);
        page = {url: site.url, status: response.status, html, title: titleOf(html), final: response.url || site.url};
      } catch (error) { page.status = 0; page.error = String(error?.message || error).slice(0, 100); }
      await call(cfg, '/extension/refused-outcome', {method: 'POST', body: JSON.stringify(page)}).catch(() => null);
      read++;
    }
    if (sites.length) await call(cfg, '/extension/refused-done', {method: 'POST', body: '{}'}).catch(() => null);
    return {read};
  } finally { running = false; }
}

// Read now: the app says one is waiting (a job opened, Check for new jobs); the pass then reads the due sites at once.
export async function readNowIfAsked({chrome = globalThis.chrome, call = api, config = null} = {}) {
  if (running) return {read: 0, skipped: 'running'};
  const cfg = config || await settings();
  const asked = await call(cfg, '/extension/refused-pending', {method: 'POST', body: '{}'}).catch(() => null);
  return asked?.pending ? pass({chrome, call, config: cfg}) : {read: 0};
}

export function startRefusedReads({chrome = globalThis.chrome} = {}) {
  chrome.alarms.create(ALARM, {delayInMinutes: 3, periodInMinutes: PERIOD_MIN});
  chrome.alarms.create(NOW_ALARM, {delayInMinutes: 1, periodInMinutes: 1});
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) pass({chrome}).catch(() => {});
    if (alarm.name === NOW_ALARM) readNowIfAsked({chrome}).catch(() => {});
  });
}

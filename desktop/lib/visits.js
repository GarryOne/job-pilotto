// Sites only you can open (owner, 7 Oct 2026): employers whose job site refuses automated visitors and portals with no API (LinkedIn,
// Indeed, Glassdoor). The app opens the page in the browser that has the extension; the person, as themselves, presses "Read the jobs" in
// the extension, which sends each page it sees here; the engine reads it (src/sources/visits.py) and the next jobs check scores it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromeCommand, extensionBrowser, launchBrowser} from './apply.js';
import * as pipeline from './pipeline.js';
import {log} from './log.js';

const NO_BROWSER = 'No Chrome (or Edge, Brave, Vivaldi) found to open it in. Install Chrome and the Job Pilotto extension.';

export function open(url, run = spawn) {
  if (!/^https:\/\//.test(url || '')) return {ok: false, error: 'This site has no address to open.'};
  const command = chromeCommand([url], process.platform, process.env, fs.existsSync, extensionBrowser());
  if (!command) return {ok: false, error: NO_BROWSER};
  run(...command, {detached: true, stdio: 'ignore'}).unref();
  log('visit', 'opened a site only the user can open', {host: new URL(url).hostname, decidedBy: 'user click'});
  return {ok: true};
}

// The Read sites task's own log (owner's Technical log): while it runs, what the engine says for each page goes there too (another session's
// report, 7 Oct 2026: its log showed 4 lines and "no new output for 5 min" while visit-filters ran 130 s, printing only to app.log).
let taskTee = null;
// Indented: kept in the log as detail, never the task's running step (pipeline isProgressStep skips indented lines); the step is runAll's own.
const onLine = line => { if (taskTee && String(line).trim()) taskTee(`  ${String(line).trim()}`); };
export const FILTER_WAIT_MS = 20000;   // Claude's filter choice: past this, the page is read as it is (it once took 130 s on LinkedIn; a site has 60 s in all)

// Any engine command that takes one JSON file (a page outline, a site's recipe): its last stdout line as JSON, or null.
async function engineJson(storage, command, body, runEngine = pipeline.run) {
  const file = path.join(os.tmpdir(), `jp-${command}-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(body));
  try {
    const {stdout} = await runEngine(storage, ['src.desktop', command, file], onLine);
    try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return null; }
  } finally {
    fs.rmSync(file, {force: true});
  }
}

// A page the quick guess could not read: Claude makes a recipe from its outline (src/ai/visit_reader.py), kept per site.
export async function understand(storage, outline, runEngine) {
  if (!/^https?:\/\//.test(String(outline?.url || ''))) return {ok: false, error: 'no page address'};
  const answer = await engineJson(storage, 'visit-understand', {url: String(outline.url), title: String(outline.title || '').slice(0, 200),
    groups: Array.isArray(outline.groups) ? outline.groups.slice(0, 12) : [], pager: Array.isArray(outline.pager) ? outline.pager.slice(0, 25) : []}, runEngine);
  log('visit', 'recipe asked of Claude', {host: new URL(outline.url).hostname, groups: outline.groups?.length || 0, found: !!answer?.recipe, next: answer?.recipe?.next});
  return answer || {ok: false, error: 'The app could not read this page.'};
}

// A page that is not a job list (a home page): the job list's address, from its own links or the AI link chooser; kept per site.
export async function jobPage(storage, page, runEngine) {
  heardFrom(page?.ticket);
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false};
  const answer = await engineJson(storage, 'visit-jobpage', {url: String(page.url), html: String(page.html || '').slice(0, MAX_HTML)}, runEngine);
  log('visit', 'job list looked for on a page that is not one', {host: new URL(page.url).hostname, found: !!answer?.url});
  return answer || {ok: false};
}

// The recipe kept for a site (or forget it: it found nothing).
export async function recipe(storage, page, runEngine) {
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false};
  if (page.forget) log('visit', 'recipe found nothing: learned again next time', {host: new URL(page.url).hostname});
  return (await engineJson(storage, 'visit-recipe', {url: String(page.url), forget: !!page.forget}, runEngine)) || {ok: false};
}

// The page's filter controls: which to set for this person's search (src/ai/visit_filters.py, through the engine's AI). Labels in the log.
export async function filters(storage, page, runEngine = pipeline.run) {
  heardFrom(page?.ticket);
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false, error: 'no page address'};
  const file = path.join(os.tmpdir(), `jp-visit-filters-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({url: String(page.url), title: String(page.title || '').slice(0, 300), controls: Array.isArray(page.controls) ? page.controls.slice(0, 200) : []}));
  try {
    const late = new Promise(resolve => setTimeout(() => resolve({late: true}), FILTER_WAIT_MS));
    const ran = await Promise.race([runEngine(storage, ['src.desktop', 'visit-filters', file], onLine), late]);
    if (ran.late) {
      log('visit', 'filters: Claude took too long, the page is read as it is', {host: new URL(page.url).hostname, waitedMs: FILTER_WAIT_MS});
      onLine(`Filters for ${new URL(page.url).hostname}: Claude took over ${FILTER_WAIT_MS / 1000} s, so the page is read as it is`);
      return {ok: false, error: `Claude took over ${FILTER_WAIT_MS / 1000} s to choose the filters: reading the page as it is`};
    }
    const answer = (() => { try { return JSON.parse(String(ran.stdout).trim().split('\n').pop()); } catch { return null; } })();
    log('visit', 'filters chosen', {host: new URL(page.url).hostname, steps: answer?.steps?.length ?? null, labels: (answer?.steps || []).map(step => step.label).join(' | ').slice(0, 300)});
    return answer || {ok: false, error: 'The app could not choose the filters.'};
  } finally {
    fs.rmSync(file, {force: true});
  }
}

// "Go to Chrome and allow" (owner, 7 Oct 2026: "the app should explicitly say it, with a call to action"): the browser with the extension to the
// front, where the extension's Allow page is the active tab.
export function focusBrowser(run = spawn, platform = process.platform) {
  const app = launchBrowser();
  if (platform === 'darwin') run('open', ['-a', app], {detached: true, stdio: 'ignore'}).unref();
  else { const command = chromeCommand([], platform, process.env, fs.existsSync, extensionBrowser()); if (command) run(...command, {detached: true, stdio: 'ignore'}).unref(); }
  log('visit', 'brought the browser forward for the Allow', {app, decidedBy: 'user click'});
  return {ok: true};
}

// One page the extension sent: through a file (a page can be megabytes), read by the engine. Counts in the log, never the page.
const MAX_HTML = 3_000_000;
export async function read(storage, page, runEngine = pipeline.run) {
  heardFrom(page?.ticket);
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false, error: 'no page address'};
  const file = path.join(os.tmpdir(), `jp-visit-${process.pid}-${Date.now()}.json`);
  const body = {url: String(page.url), title: String(page.title || '').slice(0, 300), session: String(page.session || '').slice(0, 64),
    html: String(page.html || '').slice(0, MAX_HTML), cards: Array.isArray(page.cards) ? page.cards.slice(0, 500) : []};
  fs.writeFileSync(file, JSON.stringify(body));
  try {
    const {code, stdout} = await runEngine(storage, ['src.desktop', 'visit-read', file], onLine);
    const answer = (() => { try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return null; } })();
    if (code !== 0 || !answer?.ok) {
      log('visit', 'page not read', {host: new URL(body.url).hostname, code});
      return {ok: false, error: 'The app could not read this page.'};
    }
    log('visit', 'read a page the user opened', {host: new URL(body.url).hostname, name: answer.name, jobs: answer.jobs, added: answer.added, cards: body.cards.length, session: body.session});
    return answer;
  } finally {
    fs.rmSync(file, {force: true});
  }
}

// "Read sites only you can open" (Actions, owner 7 Oct 2026): open the chosen sites in the browser with the extension, `atOnce` at a time,
// each marked so the extension filters (if asked) and reads it by itself (extension/visit.js autoRead); each reports back (done) and closes,
// then the next opens. A site that does not report within WAIT_MS counts as stopped.
export const WAIT_MS = 8 * 60 * 1000;
export const QUIET_MS = 30 * 1000;   // a site that sends no news (no page read, no wait) for this long is skipped, said in plain words
// One minute per site (owner, 7 Oct 2026): the extension stops its own read then (extension/visit.js SITE_MS); this is the app's cap
// for an extension that hangs, a little later so its own stop arrives first. Waiting on the person (the one-time Allow) is not counted.
export const SITE_MS = 75 * 1000;
const lastNews = new Map();   // ticket -> time of the extension's last report for that tab
export function heardFrom(ticket) { if (ticket && lastNews.has(ticket)) lastNews.set(ticket, Date.now()); }
const waiting = new Map();   // start address -> resolve
const blocked = new Set();
let waitingNotice = null;   // main.js: a notification whose click brings Chrome forward
export function onWaiting(fn) { waitingNotice = fn; }   // start addresses waiting on the person (the one-time Allow in Chrome)
// The extension waits on the person for a site: said in the task's log and as its running step (the banner), not "Reading …".
export function waitingFor(payload) {
  const url = which(payload);
  if (!waiting.has(url) || blocked.has(url)) return {ok: true};
  blocked.add(url);
  waitingNotice?.();
  onLine('⏳ Waiting for you in Chrome: press "Allow on the sites the app opens" on the Job Pilotto page it opened (once)');
  log('visit', 'waiting for the person in Chrome', {host: new URL(url).hostname, why: String(payload?.why || '').slice(0, 20)});
  return {ok: true};
}
const key = url => String(url || '').split('#')[0].replace(/\/$/, '');
// The tab's ticket (in its mark) first: a site that redirected reports another address. Its start address otherwise (an older extension).
const which = payload => (payload?.ticket && waiting.has(payload.ticket) ? payload.ticket : key(payload?.url));
export function done(payload) {
  const resolve = waiting.get(which(payload));
  if (resolve) { waiting.delete(which(payload)); resolve(payload); }
  return {ok: true};
}
export async function runAll(sites, {atOnce = 2, filter = true, tee = () => {}, openTab = open, waitMs = WAIT_MS, quietMs = QUIET_MS, siteMs = SITE_MS} = {}) {
  const queue = [...sites], results = [];
  taskTee = tee;
  let doneCount = 0;
  const one = async site => {
    const ticket = crypto.randomBytes(4).toString('hex');   // in the tab's mark, reported back: matched even after a redirect
    lastNews.set(ticket, Date.now());
    const openedAt = Date.now();
    const finished = new Promise(resolve => {
      waiting.set(ticket, resolve);
      const watch = setInterval(() => {   // silent too long and not waiting on the person: skipped, with words that say so
        if (!waiting.has(ticket)) { clearInterval(watch); return; }
        if (!blocked.has(ticket) && Date.now() - openedAt > siteMs) {
          clearInterval(watch);
          waiting.delete(ticket);
          resolve({stopped: `${Math.round(siteMs / 1000)} s are up: skipped, the jobs read so far are kept`, jobs: 0, added: 0, quiet: true});
          return;
        }
        if (!blocked.has(ticket) && Date.now() - (lastNews.get(ticket) || 0) > quietMs) {
          clearInterval(watch);
          waiting.delete(ticket);
          resolve({stopped: `it stopped answering (nothing for ${Math.round(quietMs / 1000)} s): skipped, you can close its tab`, jobs: 0, added: 0, quiet: true});
        }
      }, Math.min(5000, quietMs, siteMs));
      setTimeout(() => {
        if (!waiting.delete(ticket)) return;
        resolve({stopped: blocked.has(ticket) ? 'you have not allowed the extension on the sites the app opens yet (Chrome, the Job Pilotto page)'
          : 'no answer from the extension in time: is it installed and enabled in Chrome?', jobs: 0, added: 0});
      }, waitMs);
    });
    const opened = openTab(`${key(site.url)}#${filter ? 'jp-read-filter' : 'jp-read'}-${ticket}`);
    if (!opened.ok) { waiting.delete(ticket); return {...site, ok: false, why: opened.error, jobs: 0, added: 0}; }
    tee(`⏳ Reading sites in your browser: ${doneCount} of ${sites.length} done · now ${site.name}`);   // the banner's step while it reads
    const state = await finished;
    blocked.delete(ticket);
    lastNews.delete(ticket);
    if (state.quiet) tee(`⏳ ${site.name} is not responding: skipped, the next site opens`);
    const ok = (state.jobs || 0) > 0;
    tee(`${ok ? '  ✓' : '  ✗'} ${site.name}: ${ok ? `${state.jobs} jobs (${state.added || 0} new)` : state.stopped || 'nothing read'}`);
    doneCount += 1;
    tee(`⏳ Reading sites in your browser: ${doneCount} of ${sites.length} · ${site.name}: ${ok ? `${state.jobs} jobs` : 'stopped'}`);   // the window's running step
    log('visit', 'site read by the Actions task', {host: new URL(site.url).hostname, jobs: state.jobs || 0, added: state.added || 0, pages: state.pages || 0, stopped: String(state.stopped || '').slice(0, 80)});
    return {...site, ok, why: state.stopped || '', jobs: state.jobs || 0, added: state.added || 0};
  };
  const lanes = Array.from({length: Math.max(1, Math.min(5, atOnce))}, async () => {
    while (queue.length) results.push(await one(queue.shift()));
  });
  await Promise.all(lanes).finally(() => { taskTee = null; });
  return sites.map(site => results.find(result => result.url === site.url));
}
// The result as the app shows it (renderer/visits-card.js parseVisits reads exactly this).
export function resultMessage(results) {
  const read = results.filter(result => result.ok);
  const jobs = read.reduce((sum, result) => sum + result.jobs, 0), added = read.reduce((sum, result) => sum + result.added, 0);
  const clean = text => String(text || '').replace(/\s*·\s*/g, ', ').replace(/\n/g, ' ').slice(0, 120);
  return ['🌐 Sites read', `Read ${read.length} of ${results.length} site${results.length === 1 ? '' : 's'} · ${jobs} job${jobs === 1 ? '' : 's'} (${added} new)`,
    ...results.map(result => result.ok ? `✓ ${clean(result.name)} · ${result.jobs} jobs (${result.added} new) · ${key(result.url)}`
      : `✗ ${clean(result.name)} · ${clean(result.why) || 'nothing read'} · ${key(result.url)}`)].join('\n');
}

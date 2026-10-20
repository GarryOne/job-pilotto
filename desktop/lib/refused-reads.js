// Refused sites read in the user's own Chrome (owner, 19 Oct 2026; src/sources/refused_reads.py is the engine side, extension/refused-read.js the browser side).
// Unless Settings → "Read refused sites in my browser" was turned off (ON by default since 20 Oct 2026, owner: "opt-out"): the extension asks for the sites that refused the engine, fetches each once
// without cookies, and sends the page; this file hands the engine's queue out, passes each page to the engine, and shows the pass as one Recent activity row
// (kind 'visits', one site line per site, the same card as "Find jobs using your browser"). Turned off means the engine is never asked. Guard: test/refused-reads.test.js.
import * as pipeline from './pipeline.js';
import {engineJson, siteLine, resultMessage} from './visits.js';
import {log as appLog} from './log.js';
import * as now from './refused-now.js';

export const settingOn = storage => storage.settings().readRefusedSites !== false;
export const PASS_MS = 15 * 60 * 1000;   // a pass the extension never finishes (Chrome closed) ends here, with what it brought
let pass = null;   // {tee, expected, results, fits, finish}

export const passRunning = () => !!pass;

// The extension asks what to read: [] when the setting is off, a pass is running, or nothing is due (never asks the engine when off).
export async function queue(storage, {allowed = true, incognito = true, log = () => {}, run = pipeline.run, work = pipeline.work, allowanceBlock = () => false, scoreArgs = pipeline.visitsArgs} = {}) {
  const off = {ok: true, on: false, sites: []};
  if (!settingOn(storage)) return off;
  if (!!storage.settings().refusedNeedsAllow === allowed) storage.saveSettings({refusedNeedsAllow: !allowed});   // Settings says "Allow all sites in the extension once"
  if (!!storage.settings().refusedNeedsIncognito === incognito) storage.saveSettings({refusedNeedsIncognito: !incognito});   // Settings says "Allow in Incognito" for the private-window step
  if (!allowed || pass) return {...off, on: true};
  let sites = [];
  try {
    const asked = now.take();   // Read now: these sites are due at once (src/sources/refused_reads.py queue)
    const {stdout} = await run(storage, ['src.desktop', 'refused-queue', ...(asked.all ? ['--all'] : []), ...asked.hosts.flatMap(host => ['--now', host])]);
    sites = JSON.parse(String(stdout).trim().split('\n').pop()).sites || [];
  } catch { sites = []; }
  if (!sites.length) return {...off, on: true};
  appLog('refused-reads', 'pass started', {sites: sites.length});
  work(storage, 'visits', log, tee => new Promise(resolve => {
    const state = {tee, expected: sites.length, results: [], fits: 0};
    const finish = async () => {
      if (pass !== state) return;
      pass = null;
      clearTimeout(timer);
      let scored = null;
      if (state.fits && !allowanceBlock()) {   // the matching jobs are scored and listed in this run's turn, like Find jobs using your browser
        tee(`Scoring the ${state.fits} matching job${state.fits === 1 ? '' : 's'} for your Jobs list…`);
        const {stdout = ''} = await run(storage, scoreArgs(storage, state.fits), tee).catch(() => ({stdout: ''}));
        scored = /Job Matches: (\d+) created/.exec(String(stdout))?.[1] ?? null;
      }
      const text = resultMessage(state.results, {added: scored === null ? null : Number(scored)});
      tee(text.split('\n')[1]);
      tee('<<<message'); text.split('\n').forEach(line => tee(line)); tee('message>>>');
      resolve(state.results.some(result => result.ok));
    };
    state.finish = finish;
    const timer = setTimeout(finish, PASS_MS);
    pass = state;
    tee(`Reading ${sites.length} refused site${sites.length === 1 ? '' : 's'} in your browser, 1 at a time`);
    sites.forEach(site => tee(siteLine('next', site.name, site.url)));
  })).catch(error => appLog('refused-reads', 'pass failed', {error: error.message}));
  return {ok: true, on: true, sites};
}

// One page the extension fetched: the engine keeps its jobs (or the stop), and the site's line says which.
export async function outcome(storage, payload, {run = pipeline.run} = {}) {
  if (!settingOn(storage)) return {ok: false, error: 'off'};
  const url = String(payload?.url || '');
  if (!/^https:\/\//.test(url)) return {ok: false, error: 'no page address'};
  const body = {url, status: Number(payload.status) || 0, html: String(payload.html || '').slice(0, 3_000_000), title: String(payload.title || '').slice(0, 300), final: String(payload.final || '').slice(0, 500), step: ['engine', 'download', 'tab'].includes(payload.step) ? payload.step : 'download', captcha: payload.captcha === true};
  const answer = await engineJson(storage, 'refused-outcome', body, run).catch(() => null);
  const name = answer?.name || new URL(url).hostname;
  appLog('refused-reads', 'site fetched in your browser', {host: new URL(url).hostname, state: answer?.state || 'failed', jobs: answer?.jobs ?? null});
  if (!pass) return answer || {ok: false};
  const jobs = answer?.jobs || 0;
  const ok = !!answer?.ok && answer.state === 'read';
  pass.results.push({name, url, ok, jobs, added: jobs, fits: answer?.fits || 0, why: ok ? '' : answer?.why || (answer?.state === 'empty' ? 'no jobs found' : answer?.state === 'skipped' ? answer.why : 'not read')});
  pass.fits += answer?.fits || 0;
  pass.tee(siteLine(ok ? 'done' : 'stopped', name, ok ? `${jobs} job${jobs === 1 ? '' : 's'} read` : pass.results.at(-1).why));
  if (pass.results.length >= pass.expected) await pass.finish();
  return answer || {ok: false};
}

// What a page in the extension's real tab is now (page, passive_check, captcha, login, refused): the engine's AI answers, the extension waits or stops on it.
export async function judge(storage, payload, {run = pipeline.run} = {}) {
  if (!settingOn(storage)) return {ok: false, error: 'off'};
  const body = {url: String(payload?.url || '').slice(0, 500), status: Number(payload?.status) || 0, html: String(payload?.html || '').slice(0, 60000), title: String(payload?.title || '').slice(0, 300), final: String(payload?.final || '').slice(0, 500)};
  const answer = await engineJson(storage, 'refused-judge', body, run).catch(() => null);
  return {ok: !!answer?.ok, state: answer?.state || 'refused'};   // no answer: a stop, never a guess that it cleared
}

export const done = () => pass?.finish();   // the extension's pass ended (some sites left unread when Chrome stops)

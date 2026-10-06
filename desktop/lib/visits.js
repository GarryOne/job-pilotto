// Sites only you can open (owner, 7 Oct 2026): employers whose job site refuses automated visitors and portals with no API (LinkedIn,
// Indeed, Glassdoor). The app opens the page in the browser that has the extension; the person, as themselves, presses "Read the jobs" in
// the extension, which sends each page it sees here; the engine reads it (src/sources/visits.py) and the next jobs check scores it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromeCommand, extensionBrowser} from './apply.js';
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

// One page the extension sent: through a file (a page can be megabytes), read by the engine. Counts in the log, never the page.
const MAX_HTML = 3_000_000;
export async function read(storage, page, runEngine = pipeline.run) {
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false, error: 'no page address'};
  const file = path.join(os.tmpdir(), `jp-visit-${process.pid}-${Date.now()}.json`);
  const body = {url: String(page.url), title: String(page.title || '').slice(0, 300), session: String(page.session || '').slice(0, 64),
    html: String(page.html || '').slice(0, MAX_HTML), cards: Array.isArray(page.cards) ? page.cards.slice(0, 500) : []};
  fs.writeFileSync(file, JSON.stringify(body));
  try {
    const {code, stdout} = await runEngine(storage, ['src.desktop', 'visit-read', file]);
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

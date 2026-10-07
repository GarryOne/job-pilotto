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

// Any engine command that takes one JSON file (a page outline, a site's recipe): its last stdout line as JSON, or null.
async function engineJson(storage, command, body, runEngine = pipeline.run) {
  const file = path.join(os.tmpdir(), `jp-${command}-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(body));
  try {
    const {stdout} = await runEngine(storage, ['src.desktop', command, file]);
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

// The recipe kept for a site (or forget it: it found nothing).
export async function recipe(storage, page, runEngine) {
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false};
  if (page.forget) log('visit', 'recipe found nothing: learned again next time', {host: new URL(page.url).hostname});
  return (await engineJson(storage, 'visit-recipe', {url: String(page.url), forget: !!page.forget}, runEngine)) || {ok: false};
}

// The page's filter controls: which to set for this person's search (src/ai/visit_filters.py, through the engine's AI). Labels in the log.
export async function filters(storage, page, runEngine = pipeline.run) {
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false, error: 'no page address'};
  const file = path.join(os.tmpdir(), `jp-visit-filters-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({url: String(page.url), title: String(page.title || '').slice(0, 300), controls: Array.isArray(page.controls) ? page.controls.slice(0, 200) : []}));
  try {
    const {stdout} = await runEngine(storage, ['src.desktop', 'visit-filters', file]);
    const answer = (() => { try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return null; } })();
    log('visit', 'filters chosen', {host: new URL(page.url).hostname, steps: answer?.steps?.length ?? null, labels: (answer?.steps || []).map(step => step.label).join(' | ').slice(0, 300)});
    return answer || {ok: false, error: 'The app could not choose the filters.'};
  } finally {
    fs.rmSync(file, {force: true});
  }
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

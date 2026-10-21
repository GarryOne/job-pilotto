// A job's page in the app (Jobs → a row → the side panel, renderer/pages/job-panel.js): the job's record, its sections (kit, prep, review,
// record, messages, description) and its events, from the active store through the engine (lib/store/engine.js), so it reads the same on
// every store. "Open in Notion" only when the store has pages to open (caps LINKS). Demo mode: demo/job-pages.json (fictional).
// Guarded by test/job-page-handlers.test.js and test/job-page-timing.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as engine from './store/engine.js';
import {placesNow as askPlacesNow} from './places-now.js';
import {posting as crawledPosting} from './pipeline-commands.js';
import * as store from './store/index.js';
import {KIT_SECTION, kitOf} from './store/extension-store.js';
import {jobFiles} from './store/files.js';
import {demoPath} from './demo.js';

// The page in three reads, so the drawer can draw as each lands (renderer/pages/job-panel.js): the CORE (app, match, today's places: what the
// header and the Overview need), the REST (sections, events, interviews, in one engine call that reads the page's blocks once, src/stores/job_page.py)
// and the FILES (screenshots, a tailored CV: their bytes are downloaded, so they come last and only when asked). jobPage() is all three at once.
// core -> {app, match, links, placesNow?}; app null when the job has no application yet (a match nobody acted on). match: the search's
// 🎯 Job Matches record (its facts: the Match tab), null for a job added by hand.
export async function jobCore(storage, url, {call = engine.call, links = false, placesNow = askPlacesNow} = {}) {
  const [app, match] = await Promise.all([call(storage, 'applications', 'get', {url: String(url || '')}),
    call(storage, 'matches', 'get', {url: String(url || '')}).catch(() => null)]);   // no match is no Match tab, never a failed page
  // With a match: today's places, so the drawer can say a score used older ones (lib/places-now.js); failing to ask is not failing the page.
  const places = match ? {placesNow: await placesNow(storage).catch(() => '')} : {};
  return {app: app?.id ? app : null, match: match || null, links, ...places};
}

// rest -> {sections, kit, events, interviews}. Interviews and events none are not a failed page.
export async function jobRest(storage, appId, {call = engine.call} = {}) {
  if (!appId) return {sections: {}, kit: null, events: [], interviews: []};
  const found = await call(storage, 'job_page', 'read', {app_id: String(appId)});
  const sections = found?.sections || {};
  return {sections, kit: kitOf(sections[KIT_SECTION]), events: found?.events || [], interviews: found?.interviews || []};
}

// files -> [{name, type, size, tooLarge, url}] (lib/store/files.js: screenshots of logged messages, a tailored CV, as data: URLs), shown under Messages and Documents.
export const jobFilesOf = (storage, appId, {call = engine.call} = {}) => jobFiles(storage, appId, {call});

// {app, match, sections, kit, events, files, interviews, links} or {error}: all three reads, for the callers that want a whole page.
export async function jobPage(storage, url, {call = engine.call, links = false, placesNow = askPlacesNow} = {}) {
  const core = await jobCore(storage, url, {call, links, placesNow});
  if (!core.app) return {...core, sections: {}, kit: null, events: [], files: [], interviews: []};
  const [rest, files] = await Promise.all([jobRest(storage, core.app.id, {call}), jobFilesOf(storage, core.app.id, {call})]);
  return {...core, ...rest, files};
}

// A file of the job's page saved where the person picks (its data: URL from lib/store/files.js): only data: URLs, only after the dialog.
export function fileBytes(url) {
  const found = /^data:[^;,]*;base64,(.*)$/.exec(String(url || ''));
  return found ? Buffer.from(found[1], 'base64') : null;
}

// A job's code, as src/notion/client.py job_code makes it: the first 8 hex digits of the SHA-1 of its trimmed URL.
export const jobCode = url => crypto.createHash('sha1').update(String(url || '').trim()).digest('hex').slice(0, 8);

export function registerJobPageHandlers({ipcMain, storage, DEMO, here, log, dialog, call = engine.call, posting = crawledPosting}) {
  ipcMain.handle('jobFileSave', async (_, name, url) => {
    const bytes = fileBytes(url);
    if (!bytes || !dialog) return {ok: false};
    const picked = await dialog.showSaveDialog({defaultPath: path.basename(String(name || 'file'))});
    if (picked.canceled || !picked.filePath) return {ok: false};
    fs.writeFileSync(picked.filePath, bytes);
    log('jobs', 'job file saved', {bytes: bytes.length});
    return {ok: true};
  });
  // The posting the search saved for a job (the crawl's own copy, on every store): the Description tab asks for it when the job's page has
  // no description section (a job nobody applied to). {ok, description, url} or {ok: false, error}; a failure is an answer, logged.
  ipcMain.handle('jobPosting', async (_, url) => {
    if (DEMO) {   // fictional postings for a few demo jobs (demo/postings.json); the others have none saved
      const found = JSON.parse(fs.readFileSync(demoPath(here, 'postings.json'), 'utf8'))[String(url || '').trim()];
      return found ? {ok: true, url: String(url), ...found} : {ok: false, error: 'job not found'};
    }
    try {
      const found = await posting(storage, jobCode(url));
      if (!found.ok) return {ok: false, error: found.error || 'job not found'};
      const {source = '', source_kind: kind = '', first_seen_at: first = '', posted_at: posted = ''} = found;
      return {ok: true, description: String(found.description || ''), url: found.url, company: found.company || '', source, source_kind: kind, first_seen_at: first, posted_at: posted};
    } catch (error) {
      log('jobs', 'job posting not read', {error: error.message});
      return {ok: false, error: error.message, failed: true};
    }
  });
  const demoPage = url => {
    const pages = JSON.parse(fs.readFileSync(demoPath(here, 'job-pages.json'), 'utf8'));
    return pages[url] || {app: null, sections: {}, events: []};
  };
  // The three reads of the drawer (see jobCore). A failure is an answer {error}, logged, never a thrown IPC.
  const timed = (name, work) => async (_, ...args) => {
    const started = Date.now();
    try {
      const answer = await work(...args);
      log('jobs', `${name} read`, {ms: Date.now() - started});
      return answer;
    } catch (error) {
      log('jobs', `${name} not read`, {error: error.message, ms: Date.now() - started});
      return {error: error.message};
    }
  };
  ipcMain.handle('jobPageCore', timed('job core', async url => {
    if (DEMO) {
      const page = demoPage(url);
      // Demo fixtures for the states a screenshot needs: __error answers {error}, __delay_ms waits first (the loading state), as a slow store would.
      if (page.__delay) await new Promise(resolve => setTimeout(resolve, page.__delay));
      if (page.__error) return {error: page.__error};
      return {app: page.app || null, match: page.match || null, links: false, ...(page.placesNow ? {placesNow: page.placesNow} : {})};
    }
    return jobCore(storage, url, {call, links: store.openStore(storage).caps.has(store.LINKS)});
  }));
  ipcMain.handle('jobPageRest', timed('job rest', async (url, appId) => {
    if (DEMO) {
      const page = demoPage(url);
      return {sections: page.sections || {}, kit: kitOf(page.sections?.[KIT_SECTION]), events: page.events || [], interviews: page.interviews || []};
    }
    return jobRest(storage, appId, {call});
  }));
  ipcMain.handle('jobPageFiles', timed('job files', async (url, appId) => {
    if (DEMO) return demoPage(url).files || [];
    return jobFilesOf(storage, appId, {call});
  }));
  // The whole page at once (callers that want it whole).
  ipcMain.handle('jobPage', async (_, url) => {
    if (DEMO) {
      const page = demoPage(url);
      if (page.__delay) await new Promise(resolve => setTimeout(resolve, page.__delay));
      if (page.__error) return {error: page.__error};
      return {...page, kit: kitOf(page.sections?.[KIT_SECTION]), links: false};
    }
    const started = Date.now();
    try {
      const links = store.openStore(storage).caps.has(store.LINKS);
      const page = await jobPage(storage, url, {call, links});
      log('jobs', 'job page read', {sections: Object.keys(page.sections).length, events: page.events.length, files: page.files.length, kit: !!page.kit, ms: Date.now() - started});
      return page;
    } catch (error) {
      log('jobs', 'job page not read', {error: error.message, ms: Date.now() - started});
      return {error: error.message};
    }
  });
}

// A job's page in the app (Jobs → a row → the side panel, renderer/pages/job-panel.js): the job's record, its sections (kit, prep, review,
// record, messages, description) and its events, from the active store through the engine (lib/store/engine.js), so it reads the same on
// every store. "Open in Notion" only when the store has pages to open (caps LINKS). Demo mode: demo/job-pages.json (fictional).
// Guarded by test/job-page-handlers.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as engine from './store/engine.js';
import {posting as crawledPosting} from './pipeline-commands.js';
import * as store from './store/index.js';
import {KIT_SECTION, kitOf} from './store/extension-store.js';
import {jobFiles} from './store/files.js';

// {app, match, sections, kit, events, files, links} or {error}; app null when the job has no application yet (a match nobody acted on). match:
// the search's 🎯 Job Matches record (its facts: the Match tab), null for a job added by hand. files: the job's files as data: URLs
// (lib/store/files.js: screenshots of logged messages, a tailored CV), shown under Messages.
export async function jobPage(storage, url, {call = engine.call, links = false} = {}) {
  const [app, match] = await Promise.all([call(storage, 'applications', 'get', {url: String(url || '')}),
    call(storage, 'matches', 'get', {url: String(url || '')}).catch(() => null)]);   // no match is no Match tab, never a failed page
  if (!app?.id) return {app: null, match: match || null, sections: {}, kit: null, events: [], files: [], links};
  const [sections, events, files] = await Promise.all([
    call(storage, 'applications', 'sections', {app_id: app.id}),
    call(storage, 'events', 'list', {app_id: app.id}),
    jobFiles(storage, app.id, {call}),
  ]);
  return {app, match: match || null, sections: sections || {}, kit: kitOf(sections?.[KIT_SECTION]), events: events || [], files, links};
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
      const found = JSON.parse(fs.readFileSync(path.join(here, 'demo', 'postings.json'), 'utf8'))[String(url || '').trim()];
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
  ipcMain.handle('jobPage', async (_, url) => {
    if (DEMO) {
      const pages = JSON.parse(fs.readFileSync(path.join(here, 'demo', 'job-pages.json'), 'utf8'));
      const page = pages[url] || {app: null, sections: {}, events: []};
      // Demo fixtures for the states a screenshot needs: __error answers {error}, __delay_ms waits first (the loading state), as a slow store would.
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

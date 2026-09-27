// The Chrome extension talks to the app on this computer (127.0.0.1) instead of a Cloudflare Worker.
// Same endpoints and code as the Worker (worker/src/extension.js), with the user's local Profile,
// keys from the Keychain-backed store, and the local job list. Only this computer can connect, and
// every call still needs the extension token.
import * as cv from './cv.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import {handleExtension, jobKey, pageText} from '../shared/worker/extension.js';
import * as pipeline from './pipeline.js';
import * as learn from './learn.js';
import * as notion from './notion.js';
import * as questions from './questions.js';
import * as reports from './reports.js';

export const PORT = 47111;
// The extension's fixed ID (from the public "key" in extension/manifest.json). /extension/pair hands the
// connection token only to a request from this extension; web pages can't send its Origin.
export const EXTENSION_ID = 'gpffoneapcfceflfmfgedkcfbommgcfk';

export function extensionToken(storage) {
  let token = storage.secret('EXTENSION_TOKEN');
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    storage.setSecret('EXTENSION_TOKEN', token);
  }
  return token;
}

export function localEnv(storage) {
  const settings = storage.settings();
  const summary = job => ({title: job.title, company: job.company, stage: job.status, url: job.url, notion_url: ''});
  const find = async url => {
    const {jobs} = await pipeline.jobs(storage);
    const key = jobKey(url);
    return jobs.find(job => job.url === url || (key && job.url.includes(key)));
  };
  const notionToken = storage.secret('NOTION_TOKEN');
  const ids = settings.notionIds || {};
  return {
    EXTENSION_TOKEN: extensionToken(storage),
    ANTHROPIC_API_KEY: storage.secret('ANTHROPIC_API_KEY'),
    NOTION_TOKEN: notionToken,
    NOTION_APPLICATIONS_DB: ids.NOTION_APPLICATIONS_DB || '',
    NOTION_AGENT_RUNS_DB: ids.NOTION_AGENT_RUNS_DB || '',
    NOTION_PROFILE_PAGE_ID: ids.NOTION_PROFILE_PAGE_ID || '',
    NOTION_ANSWERS_PAGE_ID: ids.NOTION_ANSWERS_PAGE_ID || '',
    // Without Notion, the local copies; with it, extension.js reads the Notion pages.
    ...(notionToken ? {} : {PROFILE_TEXT: storage.readText('profile.md'), ANSWERS_TEXT: storage.readText('answers.md')}),
    JOB_PILOTTO_KIT_MODEL: pipeline.MODELS.kit,
    queue: async () => (await pipeline.jobs(storage)).jobs.filter(j => ['unreviewed', 'saved'].includes(j.status)).slice(0, 25).map(summary),
    markApplied: async url => {
      const job = await find(url);
      if (!job) return {ok: false, error: 'This job isn\'t in your list'};
      await pipeline.setStatus(storage, job.url, 'applied');
      notify('Marked Applied ✓', `${jobName(job)}. Saved in Job Pilotto and your Notion.`);
      return {ok: true, message: 'Marked Applied in Job Pilotto.'};
    },
    KNOWLEDGE_TEXT: learn.asText(settings.formKnowledge),
    localJob: async url => { const job = await find(url); return job ? summary(job) : null; },
    onRun: async run => {
      const job = await find(run.url).catch(() => null);
      const added = questions.collect(storage, run, job?.company || '');
      if (added) notify('New question to answer once', `${added} question${added > 1 ? 's' : ''} from ${job?.company || 'a form'} had no standard answer. Answer in Job Pilotto → Jobs.`);
      learnFromRun(storage, run, job).catch(error => console.error('Form knowledge:', error.message));
      reports.send(storage, run).catch(error => console.error('Fill report:', error.message));
    },
  };
}

// onError: the port can be taken (another copy of the app, a test run); the app keeps working without
// the extension connection instead of crashing.
// After a fill that left fields: learn reusable notes from its record (one small Claude call), keep them for
// the extension and mirror them to the user's 🧠 Form knowledge page in Notion (kits read that page).
async function learnFromRun(storage, run, job) {
  const apiKey = storage.secret('ANTHROPIC_API_KEY');
  if (!apiKey) return;
  const settings = storage.settings(), token = storage.secret('NOTION_TOKEN'), ids = settings.notionIds || {};
  const studied = settings.formKnowledgeStudied || {};
  const fresh = learn.newFields(run, studied, settings.formKnowledge || []);
  if (!fresh.length) return;  // this site's fields were already studied: no AI call
  const env = {NOTION_TOKEN: token};
  const [profile, answers] = token ? await Promise.all([
    ids.NOTION_PROFILE_PAGE_ID ? pageText(env, ids.NOTION_PROFILE_PAGE_ID).catch(() => '') : '',
    ids.NOTION_ANSWERS_PAGE_ID ? pageText(env, ids.NOTION_ANSWERS_PAGE_ID).catch(() => '') : '']) :
    [storage.readText('profile.md'), storage.readText('answers.md')];
  const {notes, usd} = await learn.learn({run, profile, answers, contact: settings.contact || {}, known: settings.formKnowledge || [], studied, apiKey});
  const site = learn.siteOf(run.url);
  // Remember what was studied, learned or not (a missing personal fact won't be retried; it's in Answer once).
  storage.saveSettings({formKnowledgeStudied: {...studied, [site]: [...new Set([...(studied[site] || []), ...fresh.map(f => learn.labelKey(f.label))])]}});
  if (!notes.length) return;
  storage.saveSettings({formKnowledge: learn.merge(storage.settings().formKnowledge, notes)});
  if (token && ids.NOTION_PROFILE_PAGE_ID) {
    let page = ids.NOTION_KNOWLEDGE_PAGE;
    if (!page) {
      page = await notion.ensurePage(token, ids.NOTION_PROFILE_PAGE_ID, learn.PAGE_TITLE,
        'What Job Pilotto learned from your form fills, used by every later kit and fill. Delete a line to make it forget.');
      storage.saveSettings({notionIds: {...storage.settings().notionIds, NOTION_KNOWLEDGE_PAGE: page}});
    }
    await notion.appendBullets(token, page, notes.map(n => `[${n.scope}] ${n.field}: ${n.note}${n.value ? ` → "${n.value}"` : ''}`));
  }
  notify('Learned from this form', `${notes.length} note${notes.length > 1 ? 's' : ''} for next time (${job?.company || 'this form'}, $${usd.toFixed(3)}).`);
}

// The user's details live in the app (Settings → Your details, filled from the CV by the strategy draft);
// the extension asks for them each time it fills a form (GET /extension/me with its token), so it keeps no copy.
// With the job page's URL (?url=), a CV tailored to that job is sent instead of the base one (same file name).
export function me(storage, url = '') {
  const settings = storage.settings();
  let resume = null;
  const tailored = url ? cv.forUrl(storage, url) : null;
  try {
    const data = fs.readFileSync(tailored ? cv.pdfPath(storage, tailored.job.code) : storage.path('cv.pdf'));
    resume = {name: settings.cvName || 'CV.pdf', type: 'application/pdf', data: data.toString('base64'), tailored: !!tailored};
  } catch {}
  // Learned notes that answer a field directly (kind answer/option), for the extension to use at fill time.
  const knowledge = (settings.formKnowledge || []).filter(n => n.value && ['answer', 'option'].includes(n.kind));
  return {contact: settings.contact || {}, resume, knowledge};
}

// Desktop notifications for what happens in Chrome (set by main.js): the fill starting and finishing,
// and the application being marked Applied.
let notify = () => {};
export const setNotifier = fn => { notify = fn; };
const jobName = job => job ? `${job.title} · ${job.company}` : 'this job';

// Job pages open in Chrome right now, as reported by the extension (POST /extension/tabs), without #hash.
let tabs = new Set();
// When the extension last checked in (its tab reports come every 30 s), and its version.
let seen = null;
export const extensionSeen = () => seen;
export const openTabs = () => [...tabs];
export const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');

export function start(storage, onError = () => {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (req.url === '/extension/pair') {
        const ours = req.headers.origin === `chrome-extension://${EXTENSION_ID}`;
        res.writeHead(ours ? 200 : 403, {'Content-Type': 'application/json', ...(ours ? {'Access-Control-Allow-Origin': req.headers.origin} : {})});
        res.end(JSON.stringify(ours ? {url: `http://127.0.0.1:${PORT}`, token: extensionToken(storage)} : {error: 'Only the Job Pilotto extension can pair'}));
        return;
      }
      if (req.url === '/extension/tabs') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        if (ok) {
          try {
            const report = JSON.parse(body?.toString() || '{}');
            tabs = new Set((report.urls || []).map(pageKey));
            seen = {at: Date.now(), version: report.version || ''};
          } catch {}
        }
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        return;
      }
      if (req.url === '/extension/event') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        if (ok) {
          const event = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
          const {jobs} = await pipeline.jobs(storage).catch(() => ({jobs: []}));
          const job = jobs.find(j => pageKey(j.url) === pageKey(event.url));
          if (event.type === 'fill-started') notify('Filling the application…', `${jobName(job)}. Check every field before you submit.`);
          if (event.type === 'fill-done') {
            notify(event.left ? 'Form filled: a few things left for you' : 'Form filled ✓',
              `${jobName(job)}: ${event.filled} field(s) filled${event.left ? `, ${event.left} left (listed on the page)` : ''}. Review, then submit.`);
          }
        }
        return;
      }
      if (req.url === '/extension/me' || req.url.startsWith('/extension/me?')) {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        // The browser's preflight (OPTIONS, sent because of the Authorization header) carries no token: answer it.
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? me(storage, new URL(req.url, 'http://x').searchParams.get('url') || '') : {error: 'Wrong token: open the extension settings and Connect again'}));
        return;
      }
      const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
        method: req.method, headers: req.headers, ...(body && !['GET', 'HEAD'].includes(req.method) ? {body} : {}),
      });
      const response = await handleExtension(request, localEnv(storage));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: error.message}));
    }
  });
  server.on('error', onError);
  server.listen(PORT, '127.0.0.1');
  return server;
}

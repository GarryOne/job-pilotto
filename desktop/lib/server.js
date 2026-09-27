// The Chrome extension talks to the app on this computer (127.0.0.1) instead of a Cloudflare Worker.
// Same endpoints and code as the Worker (worker/src/extension.js), with the user's local Profile,
// keys from the Keychain-backed store, and the local job list. Only this computer can connect, and
// every call still needs the extension token.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import {handleExtension, jobKey} from '../shared/worker/extension.js';
import * as pipeline from './pipeline.js';
import * as questions from './questions.js';

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
    localJob: async url => { const job = await find(url); return job ? summary(job) : null; },
    onRun: async run => {
      const job = await find(run.url).catch(() => null);
      const added = questions.collect(storage, run, job?.company || '');
      if (added) notify('New question to answer once', `${added} question${added > 1 ? 's' : ''} from ${job?.company || 'a form'} had no standard answer. Answer in Job Pilotto → Jobs.`);
    },
  };
}

// onError: the port can be taken (another copy of the app, a test run); the app keeps working without
// the extension connection instead of crashing.
// The user's details live in the app (Settings → Your details, filled from the CV by the strategy draft);
// the extension asks for them each time it fills a form (GET /extension/me with its token), so it keeps no copy.
export function me(storage) {
  const settings = storage.settings();
  let resume = null;
  try {
    const data = fs.readFileSync(storage.path('cv.pdf'));
    resume = {name: settings.cvName || 'CV.pdf', type: 'application/pdf', data: data.toString('base64')};
  } catch {}
  return {contact: settings.contact || {}, resume};
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
      if (req.url === '/extension/me') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        // The browser's preflight (OPTIONS, sent because of the Authorization header) carries no token: answer it.
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? me(storage) : {error: 'Wrong token: open the extension settings and Connect again'}));
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

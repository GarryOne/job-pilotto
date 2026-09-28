// The Chrome extension talks to the app on this computer (127.0.0.1) instead of a Cloudflare Worker.
// Same endpoints and code as the Worker (worker/src/extension.js), with the user's local Profile,
// keys from the Keychain-backed store, and the local job list. Only this computer can connect, and
// every call still needs the extension token.
import * as cv from './cv.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import * as strategy from './strategy.js';
import * as knowledge from './knowledge.js';
import * as contactDetails from './contact.js';
import {handleExtension, jobKey, pageText} from '../shared/worker/extension.js';
import * as pipeline from './pipeline.js';
import * as learn from './learn.js';
import * as notion from './notion.js';
import * as questions from './questions.js';
import {log} from './log.js';
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
    // extension.js reads the Profile, standard answers and 🧠 Form knowledge pages from Notion.
    JOB_PILOTTO_KIT_MODEL: pipeline.MODELS.kit,
    markApplied: async url => {
      const job = await find(url);
      if (!job) return {ok: false, error: 'This job isn\'t in your list'};
      const result = await pipeline.setStatus(storage, job.url, 'applied');
      if (!result.ok) return {ok: false, error: result.error || 'Could not mark it Applied'};
      notify('Marked Applied ✓', `${jobName(job)}. Saved in your Notion.`);
      return {ok: true, message: 'Marked Applied in your Notion.'};
    },
    NOTION_KNOWLEDGE_PAGE: ids.NOTION_KNOWLEDGE_PAGE || '',
    localJob: async url => { const job = await find(url); return job ? summary(job) : null; },
    onRun: async run => {
      const job = await find(run.url).catch(() => null);
      const added = await questions.collect(storage, run, job?.company || '').catch(error => {
        console.error('Open questions:', error.message);
        return 0;
      });
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
  const known = await knowledge.notes(storage);
  const fresh = learn.newFields(run, studied, known);
  if (!fresh.length) return;  // this site's fields were already studied: no AI call
  const {profile, answers} = await strategy.profileTexts(storage).catch(() => ({profile: '', answers: ''}));
  const {notes, usd} = await learn.learn({run, profile, answers, contact: await contactOf(storage), known, studied, apiKey});
  const site = learn.siteOf(run.url);
  // Remember what was studied, learned or not (a cache on the Mac: a missing personal fact isn't retried; it's in Answer once).
  storage.saveSettings({formKnowledgeStudied: {...studied, [site]: [...new Set([...(studied[site] || []), ...fresh.map(f => learn.labelKey(f.label))])]}});
  if (!notes.length) return;
  await knowledge.add(storage, notes);
  notify('Learned from this form', `${notes.length} note${notes.length > 1 ? 's' : ''} for next time (${job?.company || 'this form'}, $${usd.toFixed(3)}).`);
}

// The user's details live in the app (Settings → Your details, filled from the CV by the strategy draft);
// the extension asks for them each time it fills a form (GET /extension/me with its token), so it keeps no copy.
// With the job page's URL (?url=), a CV tailored to that job is sent instead of the base one (same file name).
// Your details from Notion; when Notion can't be read, the last ones it gave (a cache, rebuilt at the next good
// read) and the reason, never a silent empty answer: that left a form without your name, reported as "no answer".
let lastContact = null;
async function contactOf(storage) {
  try {
    const contact = await contactDetails.read(storage);
    if (Object.keys(contact).length) lastContact = contact;
    return {contact, contactSource: 'notion', contactError: Object.keys(contact).length ? null : 'the 📇 Contact details section of your Notion Profile is empty'};
  } catch (error) {
    return {contact: lastContact || {}, contactSource: lastContact ? 'last read (Notion failed)' : 'none', contactError: `Notion: ${error.message}`};
  }
}

export async function me(storage, url = '') {
  const settings = storage.settings();
  let resume = null;
  const tailored = url ? cv.forUrl(storage, url) : null;
  try {
    const data = fs.readFileSync(tailored ? cv.pdfPath(storage, tailored.job.code) : storage.path('cv.pdf'));
    resume = {name: settings.cvName || 'CV.pdf', type: 'application/pdf', data: data.toString('base64'), tailored: !!tailored};
  } catch {}
  // Learned notes that answer a field directly (kind answer/option), for the extension to use at fill time.
  const direct = (await knowledge.notes(storage).catch(() => [])).filter(n => n.value && ['answer', 'option'].includes(n.kind))
    .map(({block, ...note}) => note);
  const details = await contactOf(storage);
  log('extension', `details for ${(() => { try { return new URL(url).hostname; } catch { return 'a form'; } })()}: ${Object.keys(details.contact).length} contact fields from ${details.contactSource}`,
    {fields: Object.keys(details.contact), cv: resume?.name || null, tailored: !!resume?.tailored, ...(details.contactError ? {error: details.contactError} : {})});
  return {...details, resume, knowledge: direct};
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
// The extension version in the app's folder (the one Chrome loads unpacked): an older one in Chrome reloads itself.
export function latestExtension(read = fs.readFileSync) {
  try { return JSON.parse(read(`${pipeline.REPO}/extension/manifest.json`, 'utf8')).version || ''; } catch { return ''; }
}
export const openTabs = () => [...tabs];
export const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');

// Apply with Claude → extension hand-off (extension/hook.js). The launcher (tools/apply-batch-claude.sh) asks
// for a ticket per job (POST /claude/ticket, from this computer, with a header web pages can't send without a
// CORS preflight this server never grants); the Claude session hands it to the extension on the form page, and
// the extension checks it here (POST /extension/ticket, with its token) before filling. Valid for 3 hours.
const tickets = new Map();
const TICKET_HOURS = 3;
export function issueTicket(job, now = Date.now()) {
  for (const [key, entry] of tickets) if (entry.expires < now) tickets.delete(key);
  const ticket = crypto.randomBytes(16).toString('hex');
  tickets.set(ticket, {job: pageKey(job), expires: now + TICKET_HOURS * 3600 * 1000});
  return ticket;
}
export function checkTicket(ticket, job, now = Date.now()) {
  const entry = tickets.get(String(ticket || ''));
  return !!entry && entry.expires > now && entry.job === pageKey(job);
}

// In-app Claude sessions (terminals.js) report their state here: the Claude Code hooks (JSON on stdin, with a
// "message" for Notification) and tools/notify.sh (form field "message"). Local programs only, as for tickets.
let sessionReporter = () => {};
export function setSessionReporter(fn) { sessionReporter = fn; }
// The application form page (extension/review.js) and its session: what is left in the form, what to show (lib/review.js).
let reviewHandler = () => ({matched: null, watch: [], commands: []});
export function setReviewHandler(fn) { reviewHandler = fn; }
// The panel's "Open in Job Pilotto": the app comes forward on that session's page.
let openHandler = () => false;
export function setOpenHandler(fn) { openHandler = fn; }

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
      if (req.url === '/claude/ticket') {
        // Only local programs: a browser page's request carries an Origin and can't add this header unasked.
        const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
        const job = (() => { try { return JSON.parse(body?.toString() || '{}').job; } catch { return ''; } })();
        res.writeHead(local && job ? 200 : 403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(local && job ? {ticket: issueTicket(job)} : {error: 'Not allowed'}));
        return;
      }
      if (req.url.startsWith('/claude/session?')) {
        const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
        const query = new URL(req.url, 'http://127.0.0.1').searchParams;
        const text = body?.toString() || '';
        const payload = (() => { try { return JSON.parse(text); } catch { return {message: new URLSearchParams(text).get('message') || ''}; } })();
        if (local) sessionReporter(query.get('id') || '', {event: query.get('event') || '', message: String(payload.message || '').slice(0, 300),
          transcript: typeof payload.transcript_path === 'string' ? payload.transcript_path : ''});
        res.writeHead(local ? 200 : 403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: local}));
        return;
      }
      if (req.url === '/claude/notify') {
        // A Claude session's tools/notify.sh where there's no osascript (Windows): the app shows it. Local only, as above.
        const local = req.method === 'POST' && req.headers['x-job-pilotto'] === 'launcher' && !req.headers.origin;
        const form = new URLSearchParams(body?.toString() || '');
        const message = form.get('message')?.slice(0, 300);
        if (local && message) notify(`Job Pilotto · ${form.get('job')?.slice(0, 120) || 'Apply with Claude'}`, message);
        res.writeHead(local && message ? 200 : 403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: !!(local && message)}));
        return;
      }
      if (req.url === '/extension/ticket') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const authorised = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const {ticket, job} = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const ok = authorised && checkTicket(ticket, job);
        res.writeHead(ok ? 200 : 403, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {ok} : {ok: false, error: authorised ? 'Unknown or expired ticket' : 'Wrong token'}));
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
        res.end(JSON.stringify(ok ? {ok, latest: latestExtension()} : {ok}));
        return;
      }
      if (req.url === '/extension/open') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const {session} = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok: ok && !!openHandler(String(session || ''))}));
        return;
      }
      if (req.url === '/extension/review') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? reviewHandler(payload) : {error: 'Wrong token'}));
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
        res.end(JSON.stringify(ok ? await me(storage, new URL(req.url, 'http://x').searchParams.get('url') || '') : {error: 'Wrong token: open the extension settings and Connect again'}));
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

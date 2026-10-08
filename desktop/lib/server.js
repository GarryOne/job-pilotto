// The Chrome extension talks to the app on this computer (127.0.0.1) instead of a Cloudflare Worker.
// Same endpoints and code as the Worker (worker/src/extension.js), with the user's local Profile,
// keys from the Keychain-backed store, and the local job list. Only this computer can connect, and
// every call still needs the extension token.
import * as pageRender from './page-render.js';
import * as cv from './cv.js';
import {isFormOf} from './apply.js';
import * as letters from './cover-letter.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import * as strategy from './strategy.js';
import * as knowledge from './knowledge.js';
import * as viewCache from './view-cache.js';
import * as contactDetails from './contact.js';
import {handleExtension, jobKey} from '../shared/worker/extension.js';
import {log as appLog} from './log.js';
import * as claudeCode from './claude-code.js';
import * as pipeline from './pipeline.js';
import * as learn from './learn.js';
import * as notion from './notion.js';
import * as questions from './questions.js';
import * as terminals from './terminals.js';
import {log} from './log.js';
import * as reports from './reports.js';
import {aiClient, judgePage, reportedConfirmations} from './confirmation.js';
import {forgetPageKind, pageKind, pageKindCache} from './page-kind.js';

export const DEFAULT_PORT = 47111;
// The port is fixed because the extension has it built in (extension/flow.js). JOB_PILOTTO_PORT moves it for a test app that runs next to the user's
// own (the end-to-end suites copy the extension with the same port, desktop/e2e/lib/extension.mjs); anything but a whole port number is ignored.
export const portFrom = (env = process.env) => (/^\d+$/.test(env.JOB_PILOTTO_PORT || '') && Number(env.JOB_PILOTTO_PORT) > 0 && Number(env.JOB_PILOTTO_PORT) < 65536 ? Number(env.JOB_PILOTTO_PORT) : DEFAULT_PORT);
export const PORT = portFrom();
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

// The application was submitted: record that (the Agent Runs row), stop Claude, and take the session off
// Application sessions. The job stays on Jobs as Applied. A session already marked Submitted is removed too,
// so one left on screen from before this still goes away on the next job-list read.
// Every session for that job ends, not one: a job can have a Claude session and a form session at once (Reopen form, Take over with Claude).
export function sessionSubmitted(url) {
  const same = String(url || '').replace(/\/$/, '');
  const found = terminals.list().filter(session => String(session.url || '').replace(/\/$/, '') === same);
  for (const session of found) {
    if (session.outcome !== 'submitted') terminals.setOutcome(session.id, 'submitted');
    terminals.remove(session.id);
  }
  return found.length ? found[found.length - 1].id : null;
}

// Sessions whose job is already Applied (or past it) in Notion: the form was submitted — that is what Applied
// means — so they leave Application sessions, whatever state the window happens to be in.
export const APPLIED = new Set(['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing',
                                'Offer', 'Rejected', 'Withdrawn', 'No response']);
export function appliedSessions(jobs = []) {
  const applied = new Set((jobs || []).filter(job => APPLIED.has(job.stage)).map(job => String(job.url || '').replace(/\/$/, '')));
  return terminals.list().filter(session => applied.has(String(session.url || '').replace(/\/$/, ''))).map(session => session.url);
}
// Run on every fresh job list (main.js 'jobs'): a session for an Applied job is left over from a previous run —
// the extension's report arrived while the app was closing, or the job was marked Applied in the window itself.
// Idempotent: once the session is gone there is nothing to end, so this can run on every read.
export function reconcileAppliedSessions(jobs = []) {
  const ended = [];
  for (const url of appliedSessions(jobs)) { if (sessionSubmitted(url)) ended.push(url); }
  return ended;
}

export function localEnv(storage, submitted = sessionSubmitted, {find: injected} = {}) {
  const settings = storage.settings();
  const summary = job => ({title: job.title, company: job.company, stage: job.status, url: job.url, notion_url: ''});
  const find = injected || (async url => {
    const {jobs} = await pipeline.jobs(storage);
    const key = jobKey(url);
    return jobs.find(job => job.url === url || (key && job.url.includes(key)));
  });
  const notionToken = storage.secret('NOTION_TOKEN');
  const ids = settings.notionIds || {};
  // extension.js calls Notion through the app's paced, retrying call(), and reads the Profile, standard answers and
  // 🧠 Form knowledge from the kept pages (lib/notion.js): only when a request needs them (getters), not on every poll.
  const kept = id => (id ? notion.pageText(notionToken, id) : Promise.resolve(''));
  return {
    notionCall: (route, method = 'GET', body) => notion.call(notionToken, method, route, body),
    get PROFILE_TEXT() { return kept(ids.NOTION_PROFILE_PAGE_ID); },
    get ANSWERS_TEXT() { return kept(ids.NOTION_ANSWERS_PAGE_ID); },
    get KNOWLEDGE_TEXT() { return kept(ids.NOTION_KNOWLEDGE_PAGE).catch(() => ''); },
    EXTENSION_TOKEN: extensionToken(storage),
    ANTHROPIC_API_KEY: storage.secret('ANTHROPIC_API_KEY'),
    // The user's own Claude Code answers the form when they chose it (Settings → AI); the API key otherwise.
    get aiClient() { return claudeCode.client(storage); },
    NOTION_TOKEN: notionToken,
    NOTION_APPLICATIONS_DB: ids.NOTION_APPLICATIONS_DB || '',
    NOTION_AGENT_RUNS_DB: ids.NOTION_AGENT_RUNS_DB || '',
    NOTION_PROFILE_PAGE_ID: ids.NOTION_PROFILE_PAGE_ID || '',
    NOTION_ANSWERS_PAGE_ID: ids.NOTION_ANSWERS_PAGE_ID || '',
    // extension.js reads the Profile, standard answers and 🧠 Form knowledge pages from Notion.
    JOB_PILOTTO_KIT_MODEL: pipeline.MODELS.kit,
    markApplied: async (url, decision = '') => {
      const job = await find(url);
      // Irreversible, so what decided it and on what evidence goes to the app's log (grep 'extension' logs/app.log):
      // for a month the app could not answer "why is this Applied?" after the fact (1 Oct 2026).
      appLog('extension', `mark Applied: ${job ? job.url : url} — ${decision || 'no reason given (older extension)'}`);
      if (!job) return {ok: false, error: 'This job isn\'t in your list'};
      const result = await pipeline.setStatus(storage, job.url, 'applied');
      if (!result.ok) return {ok: false, error: result.error || 'Could not mark it Applied'};
      // The confirmation page is the submission (the extension only reports one): the session that filled that
      // form is over too, not left in Application sessions as if Claude were still on it. The "I submitted it"
      // button's own end, without pressing anything.
      submitted(job.url);
      appliedHook({how: 'extension'});
      notify('Marked Applied ✓', `${jobName(job)}. Saved in your Notion.`, {view: 'jobs', job: job.code || job.url});
      return {ok: true, message: 'Marked Applied in your Notion.'};
    },
    NOTION_KNOWLEDGE_PAGE: ids.NOTION_KNOWLEDGE_PAGE || '',
    localJob: async url => { const job = await find(url); return job ? summary(job) : null; },
    // The extension's own decisions (worker /extension/log), cleaned at that boundary: written here so a decision made
    // in Chrome is in the app's log with everything else (1 Oct 2026: nothing recorded why a job went Applied).
    onLog: entries => {
      for (const entry of Array.isArray(entries) ? entries : []) {
        appLog('extension', `${entry?.kind || 'note'}: ${entry?.text || ''}`, entry?.fields || {});
      }
    },
    // Each Claude answer for a form's questions (worker/src/extension.js answerForm): counts and field ids only.
    onAnswer: trace => appLog('fill', `Claude answered ${trace.kept} of ${trace.fields} question(s)`, trace),
    onRun: async run => {
      // A running count of forms the extension filled (technical reports' daily health line: how much it helps).
      storage.saveSettings({formsFilled: (storage.settings().formsFilled || 0) + 1});
      const job = await find(run.url).catch(() => null);
      const added = await questions.collect(storage, run, job?.company || '').catch(error => {
        console.error('Open questions:', error.message);
        return 0;
      });
      if (added) tellWindow('moved', ['open questions']);   // the Jobs page reads the answers page again (it is not re-read on every reload, 6 Oct 2026)
      if (added) notify('New question to answer once', `${added} question${added > 1 ? 's' : ''} from ${job?.company || 'a form'} had no standard answer. Answer in Job Pilotto → Jobs.`, {view: 'jobs'});
      learnFromRun(storage, run, job).catch(error => console.error('Form knowledge:', error.message));
      reports.send(storage, run, undefined, sharedLogger).then(report => {  // each field also shows in the app reports (/telemetry)
        // A fill that failed while Chrome ran an older copy than this app ships is explained first, as its own
        // report: otherwise the fields read as "the extension can't fill these", and the cause stays invisible
        // (1 Oct 2026: a Claude session hit exactly that and filled the whole form by hand).
        const stale = staleExtension(report?.version, latestExtension());
        if (stale) formIssue({site: report.site, label: 'Job Pilotto extension', type: 'version', reason: stale, version: report.version});
        for (const field of report?.fields || []) formIssue({site: report.site, label: field.label, type: field.type, reason: field.reason, version: report.version});
      }).catch(error => console.error('Fill report:', error.message));
    },
  };
}

// onError: the port can be taken (another copy of the app, a test run); the app keeps working without
// the extension connection instead of crashing.
// After a fill that left fields: learn reusable notes from its record (one small Claude call), keep them for
// the extension and mirror them to the user's 🧠 Form knowledge page in Notion (kits read that page).
async function learnFromRun(storage, run, job) {
  if (!storage.secret('NOTION_TOKEN')) return;  // the notes live in Notion
  const known = await judgeNotes(storage, run, await knowledge.notes(storage));
  const apiKey = storage.secret('ANTHROPIC_API_KEY'), client = claudeCode.client(storage);  // Claude Code when the user chose it
  if (!apiKey && !client) return;
  const version = latestExtension(), settings = storage.settings();
  const studied = learn.studiedFor(settings, version);
  const fresh = learn.newFields(run, studied, known);
  if (!fresh.length) return;  // this site's fields were already studied: no AI call
  const {profile, answers} = await strategy.profileTexts(storage).catch(() => ({profile: '', answers: ''}));
  const {notes, usd} = await learn.learn({run, profile, answers, contact: await contactOf(storage), known, studied, apiKey, client});
  const site = learn.siteOf(run.url);
  // Remember what was studied, learned or not (a cache on the Mac: a missing personal fact isn't retried; it's in Answer once).
  storage.saveSettings({formKnowledgeVersion: version, formKnowledgeStudied: {...studied, [site]: [...new Set([...(studied[site] || []), ...fresh.map(f => learn.labelKey(f.label))])]}});
  if (!notes.length) return;
  await knowledge.add(storage, notes);
  proposalReporter(learn.proposalsOf(notes));  // label wording + profile field only, counted by the site (3+ people) before it is even a candidate
  notify('Learned from this form', `${notes.length} note${notes.length > 1 ? 's' : ''} saved in your Notion → Form knowledge (${job?.company || 'this form'}, $${usd.toFixed(3)}). Only you can see them.`);
}

// A note that has left its field empty three fills in a row is not working: drop it from the Notion page and let the field be studied again.
// Logged by site and field wording only, never the note's value.
async function judgeNotes(storage, run, known) {
  const verdict = learn.judge(run, known, storage.settings().formKnowledgeStats || {});
  if (verdict.changed) storage.saveSettings({formKnowledgeStats: verdict.stats});
  if (!verdict.drop.length) return known;
  const token = storage.secret('NOTION_TOKEN'), studied = {...(storage.settings().formKnowledgeStudied || {})};
  const gone = new Set();
  for (const {note, misses, site} of verdict.drop) {
    try { await notion.deleteBlock(token, note.block.id); } catch (error) { appLog('knowledge', `could not drop a note: ${error.message}`, {site, field: note.field}); continue; }
    gone.add(note);
    studied[site] = (studied[site] || []).filter(key => key !== learn.labelKey(note.field));
    appLog('knowledge', `dropped a note: its field stayed empty ${misses} fills in a row`, {site, scope: note.scope, field: note.field, kind: note.kind});
  }
  storage.saveSettings({formKnowledgeStudied: studied});
  return known.filter(note => !gone.has(note));
}

// The user's details live in the app (Settings → Your details, filled from the CV by the strategy draft);
// the extension asks for them each time it fills a form (GET /extension/me with its token), so it keeps no copy.
// With the job page's URL (?url=), a CV tailored to that job is sent instead of the base one (same file name).
// Your details from Notion; when Notion can't be read, the last ones it gave (a cache, rebuilt at the next good
// read) and the reason, never a silent empty answer: that left a form without your name, reported as "no answer".
let lastContact = null;
async function readContact(storage) {
  try {
    const contact = await contactDetails.read(storage);
    if (Object.keys(contact).length) { lastContact = contact; viewCache.remember(storage, 'contact', {contact}); }
    return {contact, contactSource: 'notion', contactError: Object.keys(contact).length ? null : 'the 📇 Contact details section of your Notion Profile is empty'};
  } catch (error) {
    const kept = lastContact || viewCache.recall(storage, 'contact')?.result?.contact || null;
    return {contact: kept || {}, contactSource: kept ? 'last read (Notion failed)' : 'none', contactError: `Notion: ${error.message}`};
  }
}
// Answered at once from the last good read kept on this Mac (view-cache), refreshed from Notion in the background once
// it's older than FRESH_MS; only the very first read waits for Notion. One refresh at a time per kind.
const FRESH_MS = 10 * 60 * 1000;
const refreshing = new Map();
export async function kept(storage, name, load, {now = Date.now()} = {}) {
  const saved = viewCache.recall(storage, name);
  const refresh = () => {
    if (!refreshing.has(name)) refreshing.set(name, Promise.resolve().then(load).finally(() => refreshing.delete(name)));
    return refreshing.get(name);
  };
  if (!saved) return refresh();
  if (now - Date.parse(saved.at) > FRESH_MS) refresh().catch(() => {});
  return {...saved.result, fromCache: saved.at};
}
const contactOf = storage => kept(storage, 'contact', () => readContact(storage)).then(result =>
  result.fromCache ? {contact: result.contact || {}, contactSource: `kept from Notion (${result.fromCache.slice(11, 16)})`, contactError: null} : result);
// After an edit in Settings → Your details: the kept copy is the new one at once.
export function contactSaved(storage, contact) { lastContact = contact; viewCache.remember(storage, 'contact', {contact}); }

export async function me(storage, url = '') {
  const settings = storage.settings();
  let resume = null;
  const tailored = url ? cv.forUrl(storage, url) : null;
  try {
    const data = fs.readFileSync(tailored ? cv.pdfPath(storage, tailored.job.code) : storage.path('cv.pdf'));
    // A tailored CV goes up under its own name (CV_<Name>_<Company>.pdf), so the form shows which one it got.
    resume = {name: tailored ? cv.finalName(storage, tailored) : settings.cvName || 'CV.pdf', type: 'application/pdf', data: data.toString('base64'), tailored: !!tailored};
  } catch {}
  // The approved general cover letter as a file, for forms that ask to upload one (Profile → Cover letter).
  let coverLetterFile = null;
  try {
    if (letters.status(storage).pdf) coverLetterFile = {name: 'Cover letter.pdf', type: 'application/pdf', data: fs.readFileSync(letters.pdfPath(storage)).toString('base64')};
  } catch {}
  // Learned notes that answer a field directly (kind answer/option), for the extension to use at fill time.
  const notes = await kept(storage, 'knowledge', async () => {
    const list = (await knowledge.notes(storage)).map(({block, ...note}) => note);
    viewCache.remember(storage, 'knowledge', {notes: list});
    return {notes: list};
  }).catch(() => ({notes: []}));
  const direct = (notes.notes || []).filter(n => n.value && ['answer', 'option'].includes(n.kind));
  const details = await contactOf(storage);
  // Logged only when Notion was actually read or failed: an answer from the kept copy is the normal case (no noise).
  if (!details.contactSource?.startsWith('kept')) log('extension', `details for ${(() => { try { return new URL(url).hostname; } catch { return 'a form'; } })()}: ${Object.keys(details.contact).length} contact fields from ${details.contactSource}`,
    {fields: Object.keys(details.contact), cv: resume?.name || null, tailored: !!resume?.tailored, coverLetter: !!coverLetterFile, ...(details.contactError ? {error: details.contactError} : {})});
  return {...details, resume, coverLetterFile, knowledge: direct};
}

// Desktop notifications for what happens in Chrome (set by main.js): the fill starting and finishing,
// and the application being marked Applied.
let notify = () => {};
export const setNotifier = fn => { notify = fn; };
let tellWindow = () => {};   // (channel, payload) -> the open window
export const setWindowSignal = fn => { tellWindow = fn; };
const jobName = job => job ? `${job.title} · ${job.company}` : 'this job';

// Job pages open in Chrome right now, as reported by the extension (POST /extension/tabs), without #hash.
let tabs = new Set();
let tabsHandler = () => {};
let appliedHook = () => {};   // the app counts an application the extension saw submitted (lib/analytics.js)
export function setAppliedHook(fn) { appliedHook = fn; }
let renderer = null;
export function setRenderer(fn) { renderer = fn; }   // (url) -> {status, html} | {error}: lib/page-render.js, bound in main.js
export function setTabsHandler(fn) { tabsHandler = fn; }  // ({ids, boot, reading}) -> read tabs to hand back: which Chrome tabs exist (lib/review.js binds sessions to them)
// When the extension last checked in (its tab reports come every 30 s), and its version.
let seen = null;
export const extensionSeen = () => seen;
// The extension version in the app's folder (the one Chrome loads unpacked): an older one in Chrome reloads itself.
export function latestExtension(read = fs.readFileSync) {
  try { return JSON.parse(read(`${pipeline.REPO}/extension/manifest.json`, 'utf8')).version || ''; } catch { return ''; }
}

// The sentence a stale copy deserves, or '' when the two agree (or either is unknown). One wording for the two
// places that need it: the fill failure the app records, and the sessions page's "likely cause" line.
export function staleExtension(version, latest) {
  if (!version || !latest || version === latest) return '';
  return `Chrome runs Job Pilotto extension ${version}, older than this app's ${latest}: reload it once `
    + '(chrome://extensions → ↻ on Job Pilotto); from then on it updates itself.';
}
export const openTabs = () => [...tabs];
// The session of the job a fill is on: the newest open one on that address (its posting, or a form of it).
export function sessionOfJob(url, list = terminals.list()) {
  const key = pageKey(url);
  const open = list.filter(session => !session.outcome && session.kind !== 'read' && (pageKey(session.url) === key || isFormOf(url, session.url)));
  return open.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0]?.id || '';
}
export const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');

// One line per confirmation-shaped address per run of the app. A tab report arrives every 30 s.
// The address is not a submission. Marking happens only after a submit press and an AI read of the new page.
const reportedPages = new Set();
export async function markReportedConfirmations(_storage, tabUrls, {
  sessions = () => terminals.list(), log = appLog,
} = {}) {
  const open = sessions();
  for (const page of reportedConfirmations(tabUrls, open)) {
    const key = `${page.host}/${page.id}/${page.path}`;
    if (reportedPages.has(key)) continue;
    reportedPages.add(key);
    log('extension', page.matched
      ? 'confirmation-shaped page reported for an open session: waiting for a submit press'
      : 'confirmation-shaped page reported, no open session: not marked',
      {host: page.host, id: page.id, path: page.path});
  }
}

// The extension saw a submit press and then the page changed (a redirect, or new content where the form was).
// Read that page; mark Applied only when the read says it is the site's confirmation. `judge` is injectable
// so a test never calls a model.
export async function judgeConfirmation(storage, body, {judge = judgePage, client, mark} = {}) {
  const job = String(body?.job || '');
  if (!/^https?:\/\//.test(job)) return {ok: false, confirmation: false, error: 'job url is required'};
  const verdict = await judge(client === undefined ? aiClient(storage) : client, {url: body?.page || '', title: body?.title, headings: body?.headings, text: body?.text, inputs: body?.inputs});
  appLog('extension', verdict.confirmation ? 'page after submit read as a confirmation' : `page after submit is not a confirmation${verdict.error ? `: ${verdict.error}` : ''}`,
    {host: verdict.host, path: verdict.path, inputs: verdict.inputs, ...(verdict.usd != null ? {usd: verdict.usd} : {})});
  if (!verdict.confirmation) return {ok: true, confirmation: false, error: verdict.error || ''};
  const marker = mark || (url => localEnv(storage).markApplied(url, `submit, then a page change read as a confirmation (${verdict.host}${verdict.path})`));
  const result = await marker(job);
  return {ok: !!result?.ok, confirmation: true, error: result?.ok ? '' : (result?.error || 'not marked'), message: result?.message || ''};
}

// What kind of page is this (lib/page-kind.js): the AI decides once per site and page shape, the answer is kept on this Mac. The extension
// asks before it acts on a page of an application's journey, and goes by its structure rule when this has no kind. `decide` is injectable.
let kindCache = null;
export async function decidePageKind(storage, body, {decide = pageKind, client} = {}) {
  kindCache ||= pageKindCache(storage.path('page-kinds.json'));
  if (body?.forget) {   // the page contradicted its kept kind: dropped, asked again next visit
    const dropped = forgetPageKind(kindCache, {url: body?.url, controls: body?.controls});
    appLog('extension', `page kind forgotten: ${String(body.reason || 'contradicted by the page').slice(0, 80)}`, {shape: dropped || '(nothing kept)', was: String(body.kind || '').slice(0, 20)});
    return {ok: true, forgotten: !!dropped};
  }
  const answer = await decide(client === undefined ? aiClient(storage) : client, {url: body?.url, title: body?.title, headings: body?.headings,
    controls: body?.controls, buttons: body?.buttons}, kindCache);
  appLog('extension', answer.kind && !answer.error ? `page kind: ${answer.kind}` : `page kind: none (${answer.error || 'no answer'}), the structure rule decides`,
    {shape: answer.shape || '', by: answer.by || '', confidence: answer.confidence ?? null, ...(answer.usd != null ? {usd: answer.usd} : {})});
  return answer.error ? {ok: true, kind: '', error: answer.error} : {ok: true, kind: answer.kind, role: answer.role, by: answer.by, confidence: answer.confidence};
}

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
let sharedLogger = null;   // lib/shared-log.js: a copy of what is sent to the service, for Settings → "See what's sent"
export function setSharedLogger(fn) { sharedLogger = fn; }
let proposalReporter = () => {};
export function setProposalReporter(fn) { proposalReporter = fn; }
let sessionReporter = () => {};
export function setSessionReporter(fn) { sessionReporter = fn; }
// The application form page (extension/review.js) and its session: what is left in the form, what to show (lib/review.js).
let reviewHandler = () => ({matched: null, watch: [], commands: []});
let sitePasswordHandler = () => ({ok: false});
export function setSitePasswordHandler(fn) { sitePasswordHandler = fn; }   // ({host}) → {ok, password}: the extension fills a sign-in/sign-up page (lib/credentials.js)
export function setReviewHandler(fn) { reviewHandler = fn; }
let learnedHandler = () => {};
export function setLearnedHandler(fn) { learnedHandler = fn; }
let visitHandler = async () => ({ok: false});   // a page the person opened and asked the extension to read (lib/visits.js)
export function setVisitHandler(fn) { visitHandler = fn; }
let visitMore = {};   // '/extension/visit-understand', '/extension/visit-recipe': (payload) => answer (lib/visits.js)
export function setVisitRoute(route, fn) { visitMore[route] = fn; }
let visitFilters = async () => ({ok: false});   // which filters to set on a page, for this search (lib/visits.js filters)
export function setVisitFilters(fn) { visitFilters = fn; }
let visitHosts = () => [];   // the sites on the visit list, for the extension's toolbar icon
export function setVisitHosts(fn) { visitHosts = fn; }
let missesHandler = () => {};
export function setMissesHandler(fn) { missesHandler = fn; }
let controlsHandler = () => {};
export function setControlsHandler(fn) { controlsHandler = fn; }
let aliasesHandler = async () => [];
export function setAliasesHandler(fn) { aliasesHandler = fn; }  // label meanings for the form in front of the extension (lib/aliases.js)
let recipesHandler = async () => ({});
export function setRecipesHandler(fn) { recipesHandler = fn; }  // recipes for the fingerprints on a form (lib/recipes.js)  // how the generic operators fared (lib/control-events.js)  // controls the form model could not read (lib/misses.js)  // what you answered yourself in a form (lib/learned.js)
// Review in form, when the panel is not on the tab yet: which open tabs to inject into, and whether the field was there.
let joinHandler = () => [];
export function setJoinHandler(fn) { joinHandler = fn; }
let focusHandler = () => ({ok: false});
export function setFocusHandler(fn) { focusHandler = fn; }
// The panel's "Open in Job Pilotto": the app comes forward on that session's page.
let stuckHandler = () => {};  // the extension can't get to a form (no form / needs an account): the app's session offers Apply with Claude
export function setStuckHandler(fn) { stuckHandler = fn; }
let takeOverHandler = () => {};  // the panel's "Take over with Claude": the person asks for Claude on this application (set by main.js)
export function setTakeOverHandler(fn) { takeOverHandler = fn; }
let tailorHandler = () => {};  // the panel's "Tailor my CV for this job" (set by main.js)
export function setTailorHandler(fn) { tailorHandler = fn; }
let formIssue = () => {};  // technical reports: a field the extension couldn't fill (lib/telemetry.js, set by main.js)
export function setFormIssueHandler(fn) { formIssue = fn; }
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
      if (req.url === '/engine/render') {
        // The engine asks for a page after its scripts ran (lib/page-render.js): a local program with this run's key, never a web page (Origin).
        const allowed = req.method === 'POST' && !req.headers.origin && req.headers['x-job-pilotto-render'] === pageRender.TOKEN && renderer;
        const asked = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const result = allowed ? await renderer(String(asked.url || ''), pageRender.agentOf(asked.user_agent)) : {error: 'Not allowed'};
        res.writeHead(allowed ? 200 : 403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(result));
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
        if (local && message) notify(`Job Pilotto · ${form.get('job')?.slice(0, 120) || 'Apply with Claude'}`, message, {view: 'sessions'});
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
        let reread = [];   // read tabs to hand back to an extension that restarted mid-read (lib/visits.js noteTabs)
        if (ok) {
          try {
            const report = JSON.parse(body?.toString() || '{}');
            tabs = new Set((report.urls || []).map(pageKey));
            const at = Date.now(), version = report.version || '';
            // The first check-in since the app started, one after a silence, or a new version: "when did the extension
            // last reach the app?" is answerable from the log (the every-30-s ones in between are not written).
            const why = !seen ? 'first since the app started' : seen.version !== version ? `version ${seen.version || '?'} → ${version}`
              : at - seen.at > 90 * 1000 ? `after ${Math.round((at - seen.at) / 1000)} s of silence` : '';
            if (why) appLog('extension', `checked in: ${why}`, {version, tabs: (report.urls || []).length});
            seen = {at, version};
            reread = tabsHandler({ids: report.ids, boot: report.boot, worker: report.worker, reading: report.reading, sessions: report.sessions}) || [];   // reading: Find jobs using your browser' tabs by ticket (lib/visits.js noteTabs)
            void markReportedConfirmations(storage, report.urls || []).catch(error => appLog('extension', `confirmation check failed: ${error.message}`));
          } catch {}
        }
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {ok, latest: latestExtension(), ...(reread.length ? {reread} : {})} : {ok}));
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
      if (req.url === '/extension/join' || req.url === '/extension/focus') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const answer = !ok ? {ok: false} : req.url === '/extension/join' ? {ok: true, arm: joinHandler(payload.tabs || [])} : focusHandler(payload);
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(answer));
        return;
      }
      if (req.url === '/extension/learned') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        if (ok) learnedHandler(payload);
        return;
      }
      if (req.url === '/extension/recipes') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {recipes: await recipesHandler(payload)} : {error: 'Wrong token'}));
        return;
      }
      if (req.url === '/extension/aliases') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? {aliases: await aliasesHandler()} : {error: 'Wrong token'}));
        return;
      }
      if (req.url === '/extension/controls') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        if (ok) controlsHandler(payload);
        return;
      }
      if (req.url === '/extension/misses') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify({ok}));
        if (ok) missesHandler(payload);
        return;
      }
      if (req.url === '/extension/visit-read' || req.url === '/extension/visit-list' || req.url === '/extension/visit-filters' || visitMore[req.url]) {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const answer = !ok ? {ok: false, error: 'Wrong token'} : req.url === '/extension/visit-list' ? {ok: true, hosts: visitHosts()}
          : req.url === '/extension/visit-filters' ? await visitFilters(payload) : visitMore[req.url] ? await visitMore[req.url](payload) : await visitHandler(payload);
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(answer));
        return;
      }
      if (req.url === '/extension/site-password') {
        // Only this extension's origin may read the answer, never a page. Chrome checks CORS for the extension's worker too: without
        // these headers every ask failed its preflight (8 Oct 2026) and no sign-in password was ever filled.
        const cors = {'Access-Control-Allow-Origin': `chrome-extension://${EXTENSION_ID}`, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type', Vary: 'Origin'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        res.writeHead(ok ? 200 : 401, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(ok ? await sitePasswordHandler(payload) : {error: 'Wrong token'}));
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
          // The page the panel reports may be the posting's form (Ashby /application, Lever /apply), not the posting itself.
          const job = jobs.find(j => pageKey(j.url) === pageKey(event.url)) || jobs.find(j => j.url && isFormOf(event.url, j.url));
          if (event.type === 'stuck') stuckHandler(event);
          if (event.type === 'take-over') takeOverHandler({...event, job});
          if (event.type === 'tailor-cv') tailorHandler({...event, job});
          if (event.type === 'ai-failed') formIssue({type: 'ai', site: String(event.host || '').slice(0, 80), reason: String(event.why || '').slice(0, 160)});
          // A click opens this application's session (the newest one open on this job), not just the list.
          const target = {view: 'sessions', ...(sessionOfJob(event.url) ? {session: sessionOfJob(event.url)} : {})};
          if (event.type === 'fill-started') notify('Filling the application…', `${jobName(job)}. Check every field before you submit.`, target);
          if (event.type === 'fill-done') {
            notify(event.left ? 'Form filled: a few things left for you' : 'Form filled ✓',
              `${jobName(job)}: ${event.filled} field(s) filled${event.left ? `, ${event.left} left (listed on the page)` : ''}. Review, then submit.`, target);
          }
        }
        return;
      }
      if (req.url === '/extension/page-kind') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        if (req.headers.authorization !== `Bearer ${extensionToken(storage)}`) { res.writeHead(401, {'Content-Type': 'application/json', ...cors}); res.end(JSON.stringify({ok: false, kind: '', error: 'Wrong token'})); return; }
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const answer = await decidePageKind(storage, payload);
        res.writeHead(200, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(answer));
        return;
      }
      if (req.url === '/extension/confirmation') {
        const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const ok = req.headers.authorization === `Bearer ${extensionToken(storage)}`;
        if (!ok) { res.writeHead(401, {'Content-Type': 'application/json', ...cors}); res.end(JSON.stringify({ok: false, confirmation: false, error: 'Wrong token'})); return; }
        const payload = (() => { try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; } })();
        const verdict = await judgeConfirmation(storage, payload);
        res.writeHead(200, {'Content-Type': 'application/json', ...cors});
        res.end(JSON.stringify(verdict));
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

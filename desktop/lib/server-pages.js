// Which page the extension is on: the open session of a job, the confirmation-page check that marks an application Applied, and the AI's
// "what kind of page is this". Re-exported by server.js. Guarded by desktop/test/confirmation.test.js, page-kind.test.js and targets.test.js.
import * as terminals from './terminals.js';
import {log as appLog} from './log.js';
import {aiClient, judgePage, reportedConfirmations} from './confirmation.js';
import {forgetPageKind, pageKind, pageKindCache} from './page-kind.js';
import {isFormOf} from './apply.js';
import {localEnv} from './server-env.js';
import {proposalReporter} from './server-hooks.js';

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
  // An Apply button the AI named for the first time goes to the shared label meanings (the button's wording only; 2-3 installs start a canary).
  if (answer.by === 'ai' && answer.applyButton) proposalReporter([{key: 'apply_button', phrase: answer.applyButton}]);
  return answer.error ? {ok: true, kind: '', error: answer.error}
    : {ok: true, kind: answer.kind, role: answer.role, by: answer.by, confidence: answer.confidence, applyButton: answer.applyButton || ''};
}


// Which of a page's own buttons means what the extension needs (a cookie banner's "reject non-essential", the extension/visit.js fallback
// when its words know none of them), in any language: lib/option-pick.js, kept per meaning and set of buttons. Labels only, never a value.
export async function pickChoice(storage, body, {client} = {}) {
  const options = (Array.isArray(body?.options) ? body.options : []).map(text => String(text).replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 20);
  const value = String(body?.value || '').slice(0, 80), label = String(body?.label || '').slice(0, 80);
  if (!options.length || !value) return {ok: true, choice: ''};
  const {pickOption} = await import('./option-pick.js');
  const found = await pickOption(storage, {label, value, options}, {client: client === undefined ? aiClient(storage) : client});
  appLog('extension', `button by meaning: ${found.choice ? 'picked' : 'none'}`, {meaning: value.slice(0, 40), how: found.how, buttons: options.length});
  return {ok: true, choice: options.includes(found.choice) ? found.choice : ''};
}

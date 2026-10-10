// Which page the extension is on: the open session of a job, the confirmation-page check that marks an application Applied, and the AI's
// "what kind of page is this". Re-exported by server.js. Guarded by desktop/test/confirmation.test.js, page-kind.test.js and targets.test.js.
import * as terminals from './terminals.js';
import * as contactDetails from './contact.js';
import * as notionGate from './notion-gate.js';
import {log as appLog} from './log.js';
import {aiClient, judgePage, reportedConfirmations} from './confirmation.js';
import {judgeAccount} from './account-judge.js';
import {judgeForm} from './form-judge.js';
import {escalate} from './ladder/rung4-picture.js';
import {forgetPageKind, kindKey, pageKind, pageKindCache, sketchBody} from './page-kind.js';
import {hit as ladderHit, ladderStore, lookup as ladderLookup, miss as ladderMiss, record as ladderRecord} from './ladder/learning.js';
import {otherStore, record as otherRecord} from './ladder/other.js';
import {digestLine} from './ladder/rung3-digest.js';
import {ladderLine, signalOf} from '../shared/ladder-core.js';
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
// A remembered answer (no AI call) is said once per page shape every 10 minutes: a page that waits for the person is asked every ~20 s, and the same line
// filled the log (twin, 9 Oct 2026: 50 lines in 20 min). An AI answer, an error or a different kind is always said.
export const KIND_SAID_MS = 10 * 60 * 1000;
const kindSaid = new Map();   // shape -> {kind, at}
export function kindWorthSaying(answer, said = kindSaid, now = Date.now()) {
  if (!['remembered', 'learned'].includes(answer?.by) || !answer.shape) return true;
  const last = said.get(answer.shape);
  if (last && last.kind === answer.kind && now - last.at < KIND_SAID_MS) return false;
  said.set(answer.shape, {kind: answer.kind, at: now});
  return true;
}
let others = null;   // the shapes the ladder could not read (lib/ladder/other.js)
const othersOf = storage => { const file = storage.path('ladder-other.json'); if (others?.file !== file) others = {file, store: otherStore(file)}; return others.store; };
let ladder = null;   // the ladder's learned answers (lib/ladder/learning.js), one store per file
const ladderOf = storage => { const file = storage.path('ladder-learning.json'); if (ladder?.file !== file) ladder = {file, store: ladderStore(file)}; return ladder.store; };
export async function decidePageKind(storage, body, {decide = pageKind, client} = {}) {
  kindCache ||= pageKindCache(storage.path('page-kinds.json'));
  const learnt = ladderOf(storage), shapeOf = kindKey({url: body?.url, controls: body?.controls});
  if (body?.forget || body?.signal === 'contradicted') {   // the page contradicted its kept kind: dropped, asked again next visit (a learned answer is dropped with it: one miss)
    const dropped = forgetPageKind(kindCache, {url: body?.url, controls: body?.controls});
    if (shapeOf && ladderMiss(learnt, shapeOf)) appLog('extension', 'ladder: learned answer dropped (one miss)', {shape: shapeOf});
    appLog('extension', `page kind forgotten: ${String(body.reason || 'contradicted by the page').slice(0, 80)}`, {shape: dropped || '(nothing kept)', was: String(body.kind || '').slice(0, 20)});
    appLog('extension', ladderLine({rung: 1, signal: 'contradicted'}), {shape: dropped || '(nothing kept)'});   // the kept answer (rung 1) the page contradicted: the line /admin/applying reads
    return {ok: true, forgotten: !!dropped};
  }
  if (body?.why === 'other') {   // the ladder ended with no usable answer: the shape is counted and logged, never its text (lib/ladder/other.js)
    const reported = otherRecord(othersOf(storage), shapeOf);
    if (reported) appLog('extension', `ladder: other shape=${shapeOf}`);
    return {ok: true, reported};
  }
  if (body?.verified !== undefined) {   // the extension saw the page move on after a rung 3 or 4 answer (or the person did not override it): kept for the shape, fixed values only
    const kept = ladderRecord(learnt, shapeOf, {rung: body.rung, outcome: body.outcome, kind: body.kind, signal: body.signal, verified: body.verified});
    if (kept) appLog('extension', `ladder: learned by rung ${body.rung}`, {shape: shapeOf, outcome: body.outcome});
    return {ok: true, learned: kept};
  }
  if (body?.confirmed === true) return {ok: true, hit: !!(shapeOf && ladderHit(learnt, shapeOf))};   // the page confirmed the learned answer
  const answer = await decide(client === undefined ? aiClient(storage) : client, sketchBody(body), kindCache, {fresh: body?.fresh === true, digest: body?.digest === true, learned: shape => ladderLookup(learnt, shape)});   // frames: the hosts of visible frames (a bot check), lib/page-kind.js
  if (kindWorthSaying(answer)) appLog('extension', answer.kind && !answer.error ? `page kind: ${answer.kind}` : `page kind: none (${answer.error || 'no answer'}), the structure rule decides`,
    {shape: answer.shape || '', by: answer.by || '', rung: answer.rung ?? null, confidence: answer.confidence ?? null, ...(answer.usd != null ? {usd: answer.usd} : {}), ...(answer.botCheck ? {botCheck: true} : {}), ...(answer.applyBy ? {applyBy: answer.applyBy} : {}), frames: Array.isArray(body?.frameCandidates) ? body.frameCandidates.length : 0, ...(Number.isInteger(answer.formFrame) && answer.formFrame >= 0 ? {formFrame: answer.formFrame} : {}), ...(body?.digest === true ? {digest: true} : {}), ...(answer.dropped ? {dropped: answer.dropped} : {})});   // applyBy 'other' and a dropped address are listed with the shape, never silent
  if (answer.digestSaid) appLog('extension', digestLine(answer.digestSaid), {shape: answer.shape || ''});   // the digest's validated answer: ids and fixed words only
  const climb = ladderLine({rung: answer.rung, signal: answer.signal});   // `ladder: rung N signal S`: the line the admin page reads; nothing for a confident rung
  if (climb) appLog('extension', climb, {shape: answer.shape || '', ...(answer.dropped ? {dropped: answer.dropped} : {})});
  // An Apply button the AI named for the first time goes to the shared label meanings (the button's wording only; 2-3 installs start a canary).
  if (answer.by === 'ai' && answer.applyButton && !answer.applyRoute) proposalReporter([{key: 'apply_button', phrase: answer.applyButton}]);
  const ladder = {...(answer.rung != null ? {rung: answer.rung} : {}), ...(answer.signal ? {signal: answer.signal} : {})};   // which rung answered and with what signal: the extension climbs on it (extension/ladder/core.js)
  return answer.error ? {ok: true, kind: '', error: answer.error, ...ladder}
    : {ok: true, kind: answer.kind, role: answer.role, by: answer.by, confidence: answer.confidence, applyButton: answer.applyButton || '', applyRoute: answer.applyRoute || '', applyBy: answer.applyBy || '', applyEmail: answer.applyEmail || '',
      accountStep: answer.accountStep || '', registerControl: answer.registerControl || '', signinControl: answer.signinControl || '', accountButton: answer.accountButton || '',
      ...ladder, ...(answer.digest ? {digest: answer.digest} : {}), form_frame: answer.formFrame ?? -1,
      ...(answer.botCheck ? {botCheck: true} : {})};   // a check in front of the page: the extension hands it to the person (fill-flow.js)
}


// Which of a page's own buttons means what the extension needs (a cookie banner's "reject non-essential", the extension/visit.js fallback
// when its words know none of them), in any language: lib/option-pick.js, kept per meaning and set of buttons. Labels only, never a value.
export async function pickChoice(storage, body, {client} = {}) {
  const options = (Array.isArray(body?.options) ? body.options : []).map(text => String(text).replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 20);
  const value = String(body?.value || '').slice(0, 80), label = String(body?.label || '').slice(0, 80);
  if (!options.length || !value) return {ok: true, choice: ''};
  const {pickOption, forgetOption} = await import('./option-pick.js');
  if (body?.forget) {   // the button was pressed and the banner is still there: the kept answer was wrong (lib/kept-decisions.js)
    const dropped = forgetOption(storage, {value, options});
    appLog('extension', `button by meaning: kept answer ${dropped ? 'forgotten' : 'not kept'}: the page still shows it`, {meaning: value.slice(0, 40), buttons: options.length});
    return {ok: true, forgotten: dropped};
  }
  const found = await pickOption(storage, {label, value, options}, {client: client === undefined ? aiClient(storage) : client});
  appLog('extension', `button by meaning: ${found.choice ? 'picked' : 'none'}`, {meaning: value.slice(0, 40), how: found.how, buttons: options.length});
  return {ok: true, choice: options.includes(found.choice) ? found.choice : ''};
}

// Which button of a popup in the way closes it without agreeing to anything (lib/popup-pick.js): the popup's text and its own buttons in, one of them or none out.
export async function pickPopup(storage, body, {client} = {}) {
  const {pickDismiss, forgetDismiss} = await import('./popup-pick.js');
  if (body?.forget) {   // its button was pressed and the popup is still there: the kept answer was wrong (lib/kept-decisions.js)
    const dropped = forgetDismiss(storage, {text: String(body?.text || '').slice(0, 600), buttons: Array.isArray(body?.buttons) ? body.buttons.slice(0, 20) : []});
    appLog('extension', `popup: kept button ${dropped ? 'forgotten' : 'not kept'}: the popup is still there`, {buttons: Array.isArray(body?.buttons) ? body.buttons.length : 0});
    return {ok: true, forgotten: dropped};
  }
  const found = await pickDismiss(storage, {text: String(body?.text || '').slice(0, 600), buttons: Array.isArray(body?.buttons) ? body.buttons.slice(0, 20) : []}, {client: client === undefined ? aiClient(storage) : client, log: appLog});
  appLog('extension', `popup: ${found.button ? 'closed by its button' : 'left alone'}`, {how: found.how});
  return {ok: true, button: found.button};
}

// The AI's judgment on a sign-up page, before the account button ('ready') or after it ('result'): fixed answers, never a value the person typed (lib/account-judge.js).
export async function decideAccountJudge(storage, body, {judge = judgeAccount, client} = {}) {
  const phase = body?.phase === 'result' ? 'result' : body?.phase === 'form' ? 'form' : 'ready';   // 'form': the application form's own readiness (lib/form-judge.js)
  const answer = phase === 'form' ? await judgeForm(client === undefined ? aiClient(storage) : client, body?.sketch || {}) : await judge(client === undefined ? aiClient(storage) : client, body?.sketch || {}, phase);
  appLog('extension', answer.error ? `account judgment ${phase}: none (${answer.error})` : `account judgment ${phase}: ${answer.answer}`, {botCheck: !!answer.botCheck, ...(answer.needs ? {needs: answer.needs.slice(0, 60)} : {}), ...(answer.needsKind ? {needsKind: answer.needsKind} : {}), ...(answer.unlisted ? {unlisted: answer.unlisted} : {})});   // the page's own labels (and a label the AI named that the page lacks), never a value
  const judged = {rung: 2, signal: signalOf(answer)}, climb = ladderLine(judged);   // the same fixed signals as page-kind
  if (climb) appLog('extension', climb, {phase});
  const next = phase === 'form' && !answer.error ? {step: answer.step || 'unsure', nextControl: answer.nextControl || ''} : {};   // extension/next-step.js
  return answer.error ? {ok: true, answer: '', error: answer.error, ...judged} : {ok: true, ...judged, answer: answer.answer, needs: answer.needs, needsKind: answer.needsKind || '', consentRequired: !!answer.consentRequired, botCheck: answer.botCheck, ...next};
}

// The closer look (lib/ladder/rung4-picture.js): a picture with typed values hidden, one fixed action back; opt-in, capped, account pages only. A feedback body remembers what worked.
export async function decideEscalation(storage, body, {client, contact} = {}) {
  let answer = await escalate(storage, body, {client: client === undefined ? aiClient(storage) : client});
  if (answer.action === 'fill') {   // the value comes from the person's own contact details, here, and goes only to the extension: never to the model, never to the log
    const details = await Promise.resolve(contact ? contact() : notionGate.tracking(storage) ? contactDetails.read(storage) : {}).catch(() => ({})) || {};
    const value = String(details[answer.detail] || (answer.detail === 'full_name' ? [details.first_name, details.last_name].filter(Boolean).join(' ') : '') || '').trim();
    answer = value ? {...answer, value} : {ok: true, action: 'ask_person', why: 'that detail is not saved in Your details'};
  }
  if (!body?.feedback) appLog('extension', `closer look: ${answer.action}${answer.why ? ` (${answer.why})` : ''}`, {by: answer.by || '', ...(answer.control ? {control: answer.control.slice(0, 60)} : {}), ...(answer.detail ? {detail: answer.detail} : {}), ...(answer.option ? {option: answer.option.slice(0, 40)} : {})});   // which detail, never its value
  if (body?.feedback) return answer;
  const looked = {rung: 4, signal: signalOf(answer)}, climb = ladderLine(looked);   // the closer look is rung 4: the same fixed signals
  if (climb) appLog('extension', climb, {why: String(answer.why || '').slice(0, 60)});
  return {...answer, ...looked};
}

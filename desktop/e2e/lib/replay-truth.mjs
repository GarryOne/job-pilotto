/* global document, CSS, getComputedStyle */
// The false readings a replay must never pass (owner, 12 Oct 2026, after #507: Recruitee's country box held Israel, FNAC's panel said ready with a required field left,
// a CV slot counted in with no file). They make a row look better, so a "did it get worse" check never sees them. At each replay's end:
//  TRUTH: every field the case's AI answers name holds THAT answer, compared by the value itself on the runner (a value class is too weak: Israel and Switzerland are both countries);
//  AGREEMENT: the panel's missing == the fill record's left (/extension/run trace) >= the page's own empty required controls; no "ready" with one left; no CV counted in with no file.
// The applicant and the answers are the case's fake data; nothing here is sent anywhere. Used by lib/page-replay.mjs judgeCase.
// Guards: e2e/test/replay-truth.test.mjs (pure parts), e2e/test/recorded-pages.test.mjs (every case).

import {FALSE_READINGS} from './recorded-false-readings.mjs';

// The false readings already found, per case (lib/recorded-false-readings.mjs): each is a bug to fix, never a loosened assert. A listed one is said as KNOWN BUG and does not fail;
// a new one fails; a listed one that no longer shows fails too (the fix landed: remove its line), so the ledger only shrinks.
export const loadLedger = () => FALSE_READINGS;
export function againstLedger(name, failures, ledger = loadLedger()) {
  const known = ledger[name] || [], out = [], seen = [];
  for (const line of failures) (known.includes(line) ? seen : out).push(line);
  for (const line of known) if (!seen.includes(line)) out.push(`known false reading gone (remove it from lib/recorded-false-readings.mjs): ${line}`);
  return {failures: out, known: seen};
}

const answerBodies = body => !body ? [] : Array.isArray(body) ? body.map(entry => entry?.answer) : body.byHost ? Object.values(body.byHost).flatMap(answerBodies) : [body];

// The case's answers, field -> value: every variant of /extension/answer. A field two variants answer differently is left out (which one the run got is not known here).
export function expectedAnswers(item) {
  const seen = new Map();
  for (const body of answerBodies(item?.ai?.['/extension/answer'])) {
    for (const one of body?.answers || []) {
      const value = String(one?.value ?? '').trim();
      if (!one?.field || !value) continue;
      seen.set(one.field, seen.has(one.field) && seen.get(one.field) !== value ? null : value);
    }
  }
  return new Map([...seen].filter(([, value]) => value != null));
}

const words = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const holdsRun = (outer, inner) => inner.length > 0 && outer.some((_, at) => inner.every((word, k) => outer[at + k] === word));
const digits = text => String(text || '').replace(/\D/g, '');

// Does what the page shows (a box's value, a choice's text and value) hold the answer? Equal by words, a longer option holding the answer's words in a row, or a phone by its digits.
export function sameAnswer(expected, shown = []) {
  const want = words(expected), wantDigits = digits(expected);
  return shown.some(text => {
    const have = words(text);
    if (holdsRun(have, want)) return true;
    return wantDigits.length >= 6 && want.every(word => /^\d+$/.test(word)) && digits(text).length >= 6 && (digits(text).endsWith(wantDigits.slice(-9)) || wantDigits.endsWith(digits(text).slice(-9)));
  });
}

// read: field -> {state: 'value'|'empty'|'unreadable'|'missing', shown: [text]} (readFields). An empty answered field is the agreement check's (it must be counted left).
export function truthFailures(expected, read) {
  const failures = [], counts = {compared: 0, empty: 0, unreadable: 0, missing: 0};
  for (const [field, value] of expected) {
    const got = read.get(field) || {state: 'missing', shown: []};
    if (got.state !== 'value') { counts[got.state] = (counts[got.state] || 0) + 1; continue; }
    counts.compared += 1;
    if (!sameAnswer(value, got.shown)) failures.push(`truth: ${field} holds "${String(got.shown[0] || '').slice(0, 60)}", its answer is "${value.slice(0, 60)}"`);
  }
  return {failures, counts};
}

const named = list => (list.length ? list.slice(0, 6).join(', ') : 'none');
// trace: the fill record's rows ([{label, required, outcome, source}]) or null (no fill); review: the panel's last report ({missing}) or null; panel: {present, ready};
// required: the page's own visible required controls [{name, empty}]; files: how many file boxes hold a file.
export function agreementFailures({trace, review, panel, required = [], files = 0}) {
  const failures = [];
  const cvRow = (trace || []).find(row => row.source === 'your CV');
  const traceLeft = (trace || []).filter(row => row !== cvRow && row.required && row.outcome === 'left').map(row => String(row.label));
  const panelLeft = review ? (review.missing || []).map(String) : null;
  const pageLeft = required.filter(one => one.empty).map(one => String(one.name));
  if (trace && panelLeft && traceLeft.length !== panelLeft.length) failures.push(`agreement: the fill record leaves ${traceLeft.length} required (${named(traceLeft)}), the panel ${panelLeft.length} (${named(panelLeft)})`);
  if (panelLeft && pageLeft.length > panelLeft.length) failures.push(`agreement: the page has ${pageLeft.length} required control${pageLeft.length === 1 ? '' : 's'} empty (${named(pageLeft)}), the panel counts ${panelLeft.length}`);
  if (panel?.present && panel.ready) {
    const left = [panelLeft || [], traceLeft, pageLeft].find(list => list.length) || [];
    if (left.length) failures.push(`ready: the panel says ready with ${left.length} required left (${named(left)})`);
  }
  if (cvRow?.outcome === 'filled' && !files) failures.push('cv: the fill record counts the CV in, no file box on the page holds a file');
  return failures;
}

// ---- read on the page (each frame) ----
// A field key as the extension names it (page/propose.js): "aria:<group id>", "radio:<name>", else an element id or name. -> {state, shown}
const readFieldsInPage = keys => {
  const labelOf = el => [el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent, el.closest('label')?.textContent, el.getAttribute('aria-label'), el.textContent].find(text => text && text.trim()) || '';
  const out = {};
  for (const key of keys) {
    const text = String(key);
    if (text.startsWith('aria:')) {
      const group = document.getElementById(text.slice(5)) || document.querySelector(`[data-jobpilotto-group="${CSS.escape(text.slice(5))}"]`);
      if (!group) continue;
      const on = [...group.querySelectorAll('[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"], input:checked')];
      out[key] = on.length ? {state: 'value', shown: on.flatMap(el => [labelOf(el), el.value || '', el.getAttribute('data-option') || ''])} : {state: 'empty', shown: []};
      continue;
    }
    if (text.startsWith('radio:')) {
      const list = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(text.slice(6))}"]`)];
      if (!list.length) continue;
      const on = list.find(el => el.checked);
      out[key] = on ? {state: 'value', shown: [labelOf(on), on.value]} : {state: 'empty', shown: []};
      continue;
    }
    const el = document.getElementById(text) || document.querySelector(`[name="${CSS.escape(text)}"]`);
    if (!el) continue;
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'select') {
      const chosen = [...el.selectedOptions].filter(option => option.value !== '');
      out[key] = chosen.length ? {state: 'value', shown: chosen.flatMap(option => [option.textContent.trim(), option.value])} : {state: 'empty', shown: []};
    } else if (type === 'checkbox' || type === 'radio' || type === 'file') out[key] = {state: 'unreadable', shown: []};   // a lone box's yes/no and a file are not a typed value: counted, judged elsewhere
    else if ('value' in el) out[key] = String(el.value || '').trim() ? {state: 'value', shown: [String(el.value)]} : {state: 'empty', shown: []};
    else out[key] = {state: 'unreadable', shown: []};
  }
  return out;
};
// The page's own visible required controls, by the HTML's structure (required, aria-required): a lower bound of what is required (a starred label without the attribute is not seen here).
const readRequiredInPage = () => {
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const groups = new Set(), out = [];
  for (const el of document.querySelectorAll('input[required], select[required], textarea[required], [aria-required="true"]')) {
    if (!visible(el) || el.disabled || el.closest('#jobpilotto-review-host')) continue;
    const type = (el.getAttribute('type') || '').toLowerCase(), name = el.getAttribute('name') || el.id || el.getAttribute('aria-label') || el.tagName.toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    if (type === 'radio') { if (groups.has(name)) continue; groups.add(name); out.push({name, empty: ![...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)].some(one => one.checked)}); continue; }
    const empty = type === 'checkbox' ? !el.checked : type === 'file' ? !(el.files?.length) : 'value' in el ? !String(el.value || '').trim() : !el.querySelector('[aria-checked="true"], [aria-selected="true"], input:checked');
    out.push({name, empty});
  }
  return {required: out, files: [...document.querySelectorAll('input[type=file]')].filter(el => el.files?.length).length};
};
const readPanelInPage = () => {
  const root = document.getElementById('jobpilotto-review-host')?.shadowRoot;
  return {present: !!root?.querySelector('.jp'), ready: !!root?.querySelector('.jp.ready')};
};

// Everything the checks read from a tab, over all its frames: the answered fields (first frame that has the key), the required controls and attached files (summed), the panel (top frame).
export async function readTab(page, keys) {
  const read = new Map(), required = [];
  let files = 0;
  for (const frame of page.frames()) {
    const fields = await frame.evaluate(readFieldsInPage, keys).catch(() => ({}));
    for (const [key, value] of Object.entries(fields)) if (!read.has(key)) read.set(key, value);
    const found = await frame.evaluate(readRequiredInPage).catch(() => ({required: [], files: 0}));
    required.push(...found.required);
    files += found.files;
  }
  const panel = await page.evaluate(readPanelInPage).catch(() => ({present: false, ready: false}));
  return {read, required, files, panel};
}

const parsed = request => { try { return JSON.parse(request.body); } catch { return null; } };
// The case's last fill record and the panel's last report from the requests the case's tab sent the stand-in app.
export function recordsOf(requests) {
  const runs = requests.filter(request => request.route === '/extension/run'), reviews = requests.filter(request => request.route === '/extension/review');
  const run = runs.length ? parsed(runs.at(-1)) : null;
  return {run, cut: runs.length > 0 && !run, review: reviews.length ? parsed(reviews.at(-1)) : null};
}

// The whole check at a case's end. scope: judgeCase's (page(), mine()). Waits for the fill's own record (until the case's deadline), then for the panel's next report.
export async function falseReadings(item, {page, mine}, {deadline = Date.now() + 10000, settleMs = 2500} = {}) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const filling = () => page().evaluate(() => { try { return JSON.parse(document.documentElement.dataset.jobpilottoFill || '{}').state === 'running'; } catch { return false; } }).catch(() => false);
  while (Date.now() < deadline && await filling()) await wait(300);
  await wait(settleMs);   // the panel reports on its own beat (review.js sync): its report after the fill's end
  const expected = expectedAnswers(item), tab = await readTab(page(), [...expected.keys()]), records = recordsOf(mine());
  const truth = truthFailures(expected, tab.read);
  const failures = [...truth.failures];
  if (records.cut) failures.push('agreement: the fill record reached the stand-in cut short (real-extension.mjs keeps too little of /extension/run)');
  failures.push(...agreementFailures({trace: records.run?.trace || null, review: records.review, panel: tab.panel, required: tab.required, files: tab.files}));
  const judged = againstLedger(item.name, failures);
  for (const line of judged.known) console.log(`KNOWN BUG ${item.name}: ${line}`);
  return {failures: judged.failures, known: judged.known, counts: truth.counts};
}

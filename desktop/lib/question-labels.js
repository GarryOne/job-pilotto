// The wording of a form question the filler could not answer, cleaned for the product's learning (Notion: "Knowledge as data: build plan").
// Only the form's own public wording ("Heimatort", "Notice period") and never anything the user typed: this runs on the question label,
// which comes from the page, and drops what could carry personal data (addresses, long numbers, links). The site keeps a label's text only
// when several installs report it.
// One cleaner for the app, the site and the extension's tests: extension/alias-schema.js (staged to ../shared by scripts/stage.mjs).
import {cleanLabel} from '../shared/alias-schema.js';
export {cleanLabel};

// {trace: [{label, type, required, reason}]} rows of one fill -> [{label, kind, required}] for the questions no answer matched.
export const NO_ANSWER = 'no answer in the kit, Profile or your details';
export function unplaced(trace, max = 20) {
  const out = [], seen = new Set();
  for (const row of Array.isArray(trace) ? trace : []) {
    if (!row || row.reason !== NO_ANSWER || row.type === 'file') continue;
    const label = cleanLabel(row.label);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({label, kind: String(row.type || '').replace(/[^a-z-]/g, '').slice(0, 20), required: !!row.required});
    if (out.length >= max) break;
  }
  return out;
}

// What happened on a page of an application, as one word per board (counted by the site): the extension reports {role, pressed, ok}.
export function flowState(flow) {
  const role = String(flow?.role || '');
  if (role === 'form') return flow.ok === false ? 'fill-error' : 'filled';
  if (role === 'account') return 'account';
  if (role === 'no-form') return flow.pressed ? 'no-form-after-apply' : 'no-form';
  return '';
}

// Why fields of one fill stayed empty, as a fixed word per reason (counted per board by the site). The extension's reasons are a small fixed
// set; anything else is "other". Legal/consent fields and the CV are not the filler's to fill and are not counted.
// unread: a required question the page shows that the reader did not read (extension/page/coverage.js). by_you / by_you_unread:
// at Submit, a question the person answered themselves that the fill left / never read (extension/review.js): what the fill missed.
// page_error: a question the page flagged (missing or invalid) after the Submit press.
export const LEFT_REASONS = ['no_answer', 'not_taken', 'real_click', 'no_option', 'unread', 'by_you', 'by_you_unread', 'page_error', 'other'];
export function leftReason(reason) {
  const text = String(reason || '');
  if (/^(legal|no CV)/.test(text)) return '';
  if (text.startsWith('no answer')) return 'no_answer';
  if (/^question (on the page not read|text not found)/.test(text)) return 'unread';
  if (text.startsWith('answer given')) return 'not_taken';
  if (text.startsWith('dropdown that opens')) return 'real_click';
  if (text.startsWith('dropdown clicked')) return 'no_option';
  return 'other';
}
// {trace: [{outcome, reason}]} -> [{reason, n}]
export function leftCounts(trace) {
  const counts = new Map();
  for (const row of Array.isArray(trace) ? trace : []) {
    const reason = row?.outcome === 'filled' ? '' : leftReason(row?.reason);
    if (reason) counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts].map(([reason, n]) => ({reason, n}));
}

// At Submit (extension/review.js noteMissed): {byYou: [{label, kind, unread}], invalid: [label]} -> counts per fixed reason word.
export function submitCounts(payload) {
  const byYou = Array.isArray(payload?.byYou) ? payload.byYou : [];
  const counts = [['by_you', byYou.filter(item => item && !item.unread).length], ['by_you_unread', byYou.filter(item => item?.unread).length],
    ['page_error', Array.isArray(payload?.invalid) ? payload.invalid.length : 0]];
  return counts.filter(([, n]) => n > 0).map(([reason, n]) => ({reason, n}));
}
// ... and the wording of the questions the person had to answer themselves, cleaned like any question label (the site keeps one
// only when several installs report it). A question the fill never read is kind "unread": the reading failure to learn from.
export function missedQuestions(payload, max = 20) {
  const out = [], seen = new Set();
  for (const item of Array.isArray(payload?.byYou) ? payload.byYou : []) {
    const label = cleanLabel(item?.label);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({label, kind: item.unread ? 'unread' : String(item.kind || '').replace(/[^a-z-]/g, '').slice(0, 20)});
    if (out.length >= max) break;
  }
  return out;
}

// The live page-kind calls, kept for the pool's replay candidates (owner, 11 Oct 2026: a rung-2/3 fixture is built from what the app really received, not from a
// load-time capture or a hand-written stub). Writes ONLY when the e2e harness sets LIVE_CAPTURE_DIR: with no variable there is no code path. Local only, no network.
// What is kept: the page sketch the extension sent and the app's answer, scrubbed BEFORE writing (no query string, no email, no phone, no typed value, no secret key).
// The file: <LIVE_CAPTURE_DIR>/ai-calls.json = [{route, at, request, answer}]; desktop/e2e/smoke.mjs copies it into the replay candidate's folder.
// Guard: desktop/test/live-capture.test.js (also: the shipped app source calls it in one place).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRET_KEYS = /^(value|values|typed|cookie|cookies|password|passwd|token|authorization|secret|session)$/i;   // words-ok: object KEY names to drop from what is written, never page text or a judgment about a page
const QUERY = /\?[\w%.~-]+=[^\s"'<>&]*(?:&[\w%.~-]+=[^\s"'<>&]*)*/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, PHONE = /(\+\d[\d\s().-]{8,}\d)|(\b0\d{2}[\s.]\d{3}[\s.]\d{2}[\s.]\d{2}\b)/g;
const text = value => value.replace(QUERY, '').replace(EMAIL, 'person@example.com').replace(PHONE, '');

// -> the same shape without what a public repo and a log must not hold.
export function scrub(value) {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, one]) => [key, scrub(one)]));
  return value;
}

const insideRealData = dir => {   // the app's own folder (never "Job Pilotto QA", which is the pool's)
  const real = path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto') + path.sep;
  return (path.resolve(dir) + path.sep).startsWith(real);
};

// -> true when written. Never throws: a capture must not change what the app does.
export function captureCall({route, request, answer}, {env = process.env, now = Date.now} = {}) {
  const dir = env.LIVE_CAPTURE_DIR;
  if (!dir || insideRealData(dir)) return false;
  try {
    const file = path.join(dir, 'ai-calls.json');
    fs.mkdirSync(dir, {recursive: true});
    let calls = [];
    try { calls = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* a first call */ }
    calls.push({route, at: now(), request: scrub(request), answer: scrub(answer)});
    fs.writeFileSync(file, JSON.stringify(calls, null, 1));
    return true;
  } catch { return false; }
}

// The form-answer call (worker answerForm's env.onAnswerCall, wired in server-env.js), kept the same way: which fields were asked and, per answer, its
// category and use. Never a value, a note or the page text (11 Oct 2026, Datadog: the evidence could not show that a question was never asked).
export function captureAnswer({url = '', fields = [], answers = []} = {}, options = {}) {
  const asked = (Array.isArray(fields) ? fields : []).map(f => ({field: String(f?.field || ''), label: String(f?.label || ''), type: String(f?.type || ''), required: !!f?.required}));
  const kinds = (Array.isArray(answers) ? answers : []).map(a => ({field: String(a?.field || ''), category: String(a?.category || ''), use: String(a?.use || '')}));
  return captureCall({route: '/extension/answer', request: {url: String(url), fields: asked}, answer: {answers: kinds}}, options);
}

// Reads a pool replay candidate's `ai-calls.json` ([{route, at, request, answer}], written by the harness's app-side capture): the page-kind requests the APP REALLY RECEIVED in the failing run.
// A fixture built from one has the sketch the model actually saw, frame candidates included (the load-time sketch rebuilt from page.html lacked them: datadog-greenhouse-frame, 11 Oct 2026).
// Scrubbed like the recorded pages: no query string, no address, no phone number, frame addresses never kept. Reader only: the writer is the e2e harness's. Guard: test/ladder-ai-calls.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {SKETCH_FIELDS} from '../../lib/ladder/rung2-sketch.js';
import {noEmail, noPhone, stripQuery} from './ladder-scrub.mjs';

const PAGE_KIND = '/extension/page-kind';

// -> the page-kind calls of the file ([] when it is missing, broken, or not a list), each {route, at, request, answer}.
export function readAiCalls(dir) {
  let list;
  try { list = JSON.parse(fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8')); } catch { return []; }
  return Array.isArray(list) ? list.filter(call => call?.route === PAGE_KIND && call.request && typeof call.request === 'object') : [];
}

// The first rung-2 ask (digest false) or the last digest ask (the one with the numbered candidates), by the request's own flag.
export function requestOf(calls, {digest}) {
  const wanted = calls.filter(call => (call.request.digest === true) === !!digest);
  return (digest ? wanted.at(-1) : wanted[0]) || null;
}

// The sketch as the model saw it, only the declared fields; a frame candidate keeps host, path and size (its address stays in the extension).
export function sketchFromRequest(request = {}) {
  const sketch = {};
  for (const field of SKETCH_FIELDS) {
    if (field === 'candidates' || request[field] === undefined) continue;   // the numbered candidates are a fixture's own `candidates`
    sketch[field] = field === 'frameCandidates' && Array.isArray(request[field])
      ? request[field].map(({host, path: framePath, width, height}) => ({host, path: framePath, width, height})) : request[field];
  }
  return {url: stripQuery(request.url), ...noPhone(noEmail(sketch))};   // the path is kept as it is: a long id in it is not a phone number
}

export const candidatesFromRequest = (request = {}) => noPhone(noEmail(Array.isArray(request.candidates) ? request.candidates : []));

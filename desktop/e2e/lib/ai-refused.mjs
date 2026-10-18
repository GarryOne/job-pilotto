// When the AI refuses every call (the key's spend limit, a bad key: 400 BadRequestError / "usage limits" / "credit balance"), a failed step says so instead of a
// downstream symptom ("listed: nothing", "0 new jobs"). Read from the engine's log in the test profile; used by every suite through lib/runner.mjs. Guarded by test/ai-refused.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {STUBBED} from './ai-proxy.mjs';

const REFUSED = /BadRequestError|invalid_request_error|specified API usage limits|credit balance is too low/;   // the engine's own error names and the API's messages for a refused call
const RUN_HEADER = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s+----/;   // "<time> ---- python -m src …": the run a line belongs to

// engine.log text → {count: lines that report a refused AI call, firstAt: the time of the run header above the first one ('' when none)}.
export function aiRefusals(text) {
  let count = 0, firstAt = '', at = '';
  for (const line of String(text || '').split('\n')) {
    const header = RUN_HEADER.exec(line);
    if (header) { at = header[1]; continue; }
    if (!REFUSED.test(line)) continue;
    if (!count) firstAt = at;
    count++;
  }
  return {count, firstAt};
}

// The sentence a failed step leads with, or '' (no profile, no log, no refusal).
export function refusalNote(profile, stubbed = STUBBED) {
  if (!profile) return '';
  let text = '';
  try { text = fs.readFileSync(path.join(profile, 'logs', 'engine.log'), 'utf8'); } catch { return ''; }
  const {count, firstAt} = aiRefusals(text);
  if (!count) return '';
  const stub = stubbed.size ? ` (the suite armed the stub ${[...stubbed].join(', ')} on purpose: these refusals are by design, not the account's money or limit)` : '';
  return `the AI refused (400) ${count} time${count === 1 ? '' : 's'}${firstAt ? `, first at ${firstAt}` : ''}${stub}`;
}

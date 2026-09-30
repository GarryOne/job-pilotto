// Lines of a run's log that are warnings (Notion busy, a step skipped or failed…), each once. A count of zero is not
// one: "Enriched 1 of 1 job(s); 0 failed" is a normal report line, not a warning.
const WARNING = /^Warning|\b429\b|Too Many Requests|\b(?:skipped|failed)\b|^AI limit reached/i;
const ZERO = /\b0 (?:failed|skipped)\b/gi;
const CAP = 180;
// Long API errors are capped, but at a word: "…API usage limits. You will" reads like a broken sentence.
const shorten = text => (text.length <= CAP ? text : `${text.slice(0, CAP).replace(/\s+\S*$/, '')}…`);
export const runWarnings = lines => [...new Set(lines.filter(line => WARNING.test(String(line).replace(ZERO, '')))
  .map(line => shorten(String(line).replace(/^Warning:\s*/i, ''))))];

// Everywhere a run's warnings are recorded: its log (a run on this Mac) and its page's report (lib/run-history.js
// `report` — where a GitHub run's "Warning: …" lines are, its log being one line pointing at its page). Not its
// `result`: that is the row's one-line summary, and a failed run's is just "failed".
export const runWarningLines = run => runWarnings([
  ...(Array.isArray(run?.log) ? run.log : []),
  ...(Array.isArray(run?.report) ? run.report : []),
]);

// The Anthropic account's spend limit, in any of its wordings (a line cut short still counts when another says it).
const LIMIT = /usage limits?|credit balance|AI limit reached|spending limit/i;
const SKIPPED = /^Skipped job (\S+): (.*)$/;
// "N job(s) not read by AI / not scored / left for the next check": the same loss, said three ways by the pipeline.
const UNSCORED = /^(?:AI limit reached[^,]*,\s*)?(\d+)\s+job\(s\)\s+(?:left for the next check|not read by AI|not scored|not enriched|not ranked)/i;

// A raw provider error as the sentence it means. The API's own dumping — "BadRequestError: Error code: 400 - {'type':
// 'error', 'error': {'type': 'invalid_request_error', 'message': 'You have reached your specified API usage limits…" —
// is never shown to the owner: the message inside it is, or the fact that the account's spending limit was reached.
const PROVIDER = /\b(?:BadRequestError|APIError|RateLimitError|AuthenticationError|PermissionDeniedError|InternalServerError|APIConnectionError|OverloadedError|Error code: \d{3})\b/i;
const MESSAGE = /['"]message['"]\s*:\s*['"]([^'"]{4,240})/i;
const BACK = /(?:regain access|resets?)[^.\d]{0,40}(\d{4}-\d{2}-\d{2})/i;
export function humanError(text, limit = false) {
  const raw = String(text || '').trim();
  if (!PROVIDER.test(raw)) return raw.replace(/^\w*Error:\s*/, '') || raw;
  const message = (MESSAGE.exec(raw)?.[1] || '').replace(/\s+/g, ' ').trim();
  if (limit || LIMIT.test(raw) || LIMIT.test(message)) {
    const back = (BACK.exec(raw) || BACK.exec(message) || [])[1];
    return `the Anthropic API spending limit was reached${back ? ` (back on ${back})` : ''}`;
  }
  return message || 'the AI service refused the call';
}

// Warnings as you read them: the same error on many jobs is one line ("Skipped 23 jobs (6, 7, 8, …): the Anthropic API
// spending limit was reached"), the API's raw dumping is a sentence, and the three wordings of "jobs the limit left"
// count once each and add up to one line — not six that say the same thing.
export function groupWarnings(warnings) {
  const limit = warnings.some(text => LIMIT.test(String(text)));
  const groups = new Map(), order = [], counts = new Set();
  const add = (label, id) => { if (!groups.has(label)) { groups.set(label, []); order.push(label); } if (id) groups.get(label).push(id); };
  for (const text of warnings) {
    const raw = String(text).trim().replace(/^Warning:\s*/i, '');
    const unscored = UNSCORED.exec(raw);
    if (unscored && (limit || LIMIT.test(raw))) { counts.add(Number(unscored[1])); continue; }
    const skipped = SKIPPED.exec(raw);
    if (skipped) { add(humanError(skipped[2], limit), skipped[1]); continue; }
    // "check failed: BadRequestError: …" keeps its own words in front of the sentence; a bare dump does not.
    const head = raw.split(/:\s*/)[0];
    const clean = humanError(raw, limit);
    add(head && head.length < 60 && !PROVIDER.test(head) && clean !== raw ? `${head}: ${clean}` : clean, null);
  }
  const total = [...counts].reduce((sum, count) => sum + count, 0);
  const out = total ? [`${total} job${total === 1 ? '' : 's'} left unscored: the Anthropic API spending limit was reached`] : [];
  for (const label of order) {
    const ids = groups.get(label) || [];
    if (!ids.length) { if (!out.includes(label)) out.push(label); continue; }
    out.push(`Skipped ${ids.length} job${ids.length === 1 ? '' : 's'} (${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}): ${label}`);
  }
  return out;
}

// How many jobs the spend limit left unscored: the ones that failed on it, and those the run stopped before.
export function limitedJobs(warnings) {
  if (!warnings.some(text => LIMIT.test(text))) return 0;
  const failed = warnings.filter(text => SKIPPED.test(text) && /BadRequestError|Error code: 400|usage limit/i.test(text)).length;
  const left = warnings.map(text => Number(/(\d+) job\(s\) left/.exec(text)?.[1] || 0)).reduce((a, b) => a + b, 0);
  return failed + left;
}

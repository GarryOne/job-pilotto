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
// A Find jobs using your browser run says each stopped site in its own card row (renderer/visits-card.js): its progress lines (⏳ step, ✗/✓ site, ▸ row) are not
// warnings again above it (7 Oct 2026: "IWC is not responding: skipped… And 3 more" repeated the rows).
const SITE_ROW = /^\s*(?:⏳|✗|✓|▸)/;
export const runWarningLines = run => runWarnings([
  ...(Array.isArray(run?.log) ? run.log : []),
  ...(Array.isArray(run?.report) ? run.report : []),
].filter(line => run?.kind !== 'visits' || !SITE_ROW.test(String(line))));

// The Anthropic account's spend limit, in any of its wordings (a line cut short still counts when another says it).
const LIMIT = /usage limits?|credit balance|AI limit reached|spending limit|spend limit|no credit left/i;   // the last two: OpenAI's (src/ai/providers/openai_api.py)
export const isSpendingLimit = text => LIMIT.test(String(text || ''));
const SKIPPED =/^Skipped job (\S+): (.*)$/;
// "N job(s) not read by AI / not scored / left for the next check": the same loss, said three ways by the pipeline.
const UNSCORED = /^(?:AI limit reached[^,]*,\s*)?(\d+)\s+job\(s\)\s+(?:left for the next check|not read by AI|not scored|not enriched|not ranked)/i;

// A raw provider error as the sentence it means. The API's own dumping — "BadRequestError: Error code: 400 - {'type':
// 'error', 'error': {'type': 'invalid_request_error', 'message': 'You have reached your specified API usage limits…" —
// is never shown to the owner: the message inside it is, or the fact that the account's spending limit was reached.
// Also the JavaScript SDK's form, "400 {"type":"error","error":{…}}": it reached the CV message as it was (#94, 3 Oct 2026).
const PROVIDER = /\b(?:BadRequestError|APIError|RateLimitError|AuthenticationError|PermissionDeniedError|InternalServerError|APIConnectionError|OverloadedError|Error code: \d{3})\b|^\d{3}\s*\{|["']type["']\s*:\s*["']error["']/i;
const MESSAGE = /['"]message['"]\s*:\s*['"]([^'"]{4,240})/i;
const BACK = /(?:regain access|resets?)[^.\d]{0,40}(\d{4}-\d{2}-\d{2})/i;
// The AI service answering "too many requests" / "overloaded" (429, 529): busy, not a key or permission problem.
export const AI_BUSY = /RateLimitError|OverloadedError|Error code: (?:429|529)\b/i;
// A web service answering with an HTTP error, often with its error page's HTML after it ("HTTPError: HTTP Error 502: <!DOCTYPE html>…"): the owner is told in a sentence, never the markup (#275).
const HTTP = /(?:\b\w*Error:\s*)?HTTP Error (\d{3})\b[^]*$/i;
const HTML = /<!DOCTYPE[^]*$|<html[^]*$/i;
export function httpSentence(code) {
  const status = Number(code);
  if (status === 429) return 'the service is busy right now (HTTP 429). Try again in a few minutes';
  if (status === 401 || status === 403) return `the service refused access (HTTP ${status}). Check the connection in Settings`;
  if (status >= 500) return `the service was unavailable (HTTP ${status}). It is usually back within minutes: try again`;
  return `the service answered with an error (HTTP ${status})`;
}
export function humanError(text, limit = false) {
  const raw = String(text || '').trim();
  if (!PROVIDER.test(raw) && (HTTP.test(raw) || HTML.test(raw))) {
    const code = HTTP.exec(raw)?.[1];
    return raw.replace(HTTP, '').replace(HTML, '').replace(/[:\s]+$/, '').concat(code ? `: ${httpSentence(code)}` : ': the service answered with an error page').replace(/^: /, '');
  }
  if (!PROVIDER.test(raw)) return raw.replace(/^\w*Error:\s*/, '') || raw;
  const message = (MESSAGE.exec(raw)?.[1] || '').replace(/\s+/g, ' ').trim();
  if (limit || LIMIT.test(raw) || LIMIT.test(message)) {
    const back = (BACK.exec(raw) || BACK.exec(message) || [])[1];
    return `the Anthropic API spending limit was reached${back ? ` (back on ${back})` : ''}`;
  }
  if (AI_BUSY.test(raw)) return 'the AI service is rate-limited right now';
  return message || 'the AI service refused the call';
}

// Warnings as you read them: the same error on many jobs is one line ("Skipped 23 jobs (6, 7, 8, …): the Anthropic API
// spending limit was reached"), the API's raw dumping is a sentence, and the three wordings of "jobs the limit left"
// count once each and add up to one line — not six that say the same thing.
// Known engine warnings as what they mean for you, the exact text staying in the technical log (owner, 6 Oct 2026: "candidate
// source skipped: TimeoutError" and "KeyError: 'watch'" were the box's explanation).
const PLAIN = [
  [/^candidate source skipped: (?:[\w.]+\.)?\w*Timeout\w*\b/i, () => 'One source could not be checked because it timed out.'],
  [/^candidate source skipped: /i, () => 'One source could not be checked.'],
  [/^Notion not updated for (.+?): /i, m => `The Notion update for ${m[1]} failed.`],   // about Notion
];
// A line that still ends in a raw exception ("<what>: KeyError: 'watch'"): what failed, and where its details are.
const RAW_EXCEPTION = /^(.{3,80}?):\s*(?:[\w.]+\.)?\w+(?:Error|Exception)\b.*$/;
export function plainWarning(raw) {
  for (const [pattern, words] of PLAIN) { const m = pattern.exec(raw); if (m) return words(m); }
  return null;
}
// Only for a line nothing else reworded (an HTTP status or the AI provider's error have their own sentences).
const rawException = raw => { const m = RAW_EXCEPTION.exec(raw); return m && !PROVIDER.test(raw) ? `${m[1].replace(/^./, c => c.toUpperCase())} (an internal error; details in the technical log).` : null; };
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
    const plain = plainWarning(raw);
    if (plain) { add(plain, null); continue; }
    // "check failed: BadRequestError: …" keeps its own words in front of the sentence; a bare dump does not.
    const head = raw.split(/:\s*/)[0];
    const clean = humanError(raw, limit);
    if (clean === raw.replace(/^\w*Error:\s*/, '') && rawException(raw)) { add(rawException(raw), null); continue; }
    add(head && head.length < 60 && !PROVIDER.test(head) && clean !== raw && !clean.startsWith(head) ? `${head}: ${clean}` : clean, null);
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

// The grouped lines minus those that only say again what the banner's "AI service is busy" sentence says.
// A line the summary above already says word for word is no detail either (#285: one warning was printed as the summary and again under "Hide details").
export const newDetails = (grouped, summary = '') => grouped.filter(line => !/^(?!Skipped )(?:[^:]*: )?the AI service is rate-limited right now$/.test(line) && !String(summary).includes(line.trim()));

// How many jobs the spend limit left unscored: the ones that failed on it, and those the run stopped before.
export function limitedJobs(warnings) {
  if (!warnings.some(text => LIMIT.test(text))) return 0;
  const failed = warnings.filter(text => SKIPPED.test(text) && /BadRequestError|Error code: 400|usage limit/i.test(text)).length;
  const left = warnings.map(text => Number(/(\d+) job\(s\) left/.exec(text)?.[1] || 0)).reduce((a, b) => a + b, 0);
  return failed + left;
}

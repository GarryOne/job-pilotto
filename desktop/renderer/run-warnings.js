// Lines of a run's log that are warnings (Notion busy, a step skipped or failed…), each once. A count of zero is not
// one: "Enriched 1 of 1 job(s); 0 failed" is a normal report line, not a warning.
const WARNING = /^Warning|\b429\b|Too Many Requests|\b(?:skipped|failed)\b|^AI limit reached/i;
const ZERO = /\b0 (?:failed|skipped)\b/gi;
export const runWarnings = lines => [...new Set(lines.filter(line => WARNING.test(String(line).replace(ZERO, '')))
  .map(line => String(line).replace(/^Warning:\s*/i, '').slice(0, 180)))];

// The Anthropic account's spend limit, in any of its wordings (a line cut short still counts when another says it).
const LIMIT = /usage limits?|credit balance|AI limit reached/i;
const SKIPPED = /^Skipped job (\S+): (.*)$/;

// Warnings as you read them: the same error on many jobs is one line ("Skipped 23 jobs (6, 7, 8, …): the Anthropic API
// spending limit was reached"), not 23 raw API errors.
export function groupWarnings(warnings) {
  const limit = warnings.some(text => LIMIT.test(text));
  const groups = new Map(), out = [];
  for (const text of warnings) {
    const skipped = SKIPPED.exec(text);
    if (!skipped) { out.push(text); continue; }
    const reason = limit && /BadRequestError|Error code: 400|usage limit/i.test(skipped[2]) ? 'the Anthropic API spending limit was reached'
      : skipped[2].replace(/^\w+Error:\s*/, '').slice(0, 90);
    if (!groups.has(reason)) { groups.set(reason, []); out.push(reason); }
    groups.get(reason).push(skipped[1]);
  }
  return out.map(item => {
    const ids = groups.get(item);
    if (!ids) return item;
    return `Skipped ${ids.length} job${ids.length === 1 ? '' : 's'} (${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}): ${item}`;
  });
}

// How many jobs the spend limit left unscored: the ones that failed on it, and those the run stopped before.
export function limitedJobs(warnings) {
  if (!warnings.some(text => LIMIT.test(text))) return 0;
  const failed = warnings.filter(text => SKIPPED.test(text) && /BadRequestError|Error code: 400|usage limit/i.test(text)).length;
  const left = warnings.map(text => Number(/(\d+) job\(s\) left/.exec(text)?.[1] || 0)).reduce((a, b) => a + b, 0);
  return failed + left;
}

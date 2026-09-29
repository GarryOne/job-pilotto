// Lines of a run's log that are warnings (Notion busy, a step skipped or failed…), each once. A count of zero is not
// one: "Enriched 1 of 1 job(s); 0 failed" is a normal report line, not a warning.
const WARNING = /^Warning|\b429\b|Too Many Requests|\b(?:skipped|failed)\b/i;
const ZERO = /\b0 (?:failed|skipped)\b/gi;
export const runWarnings = lines => [...new Set(lines.filter(line => WARNING.test(String(line).replace(ZERO, '')))
  .map(line => String(line).replace(/^Warning:\s*/i, '').slice(0, 180)))];

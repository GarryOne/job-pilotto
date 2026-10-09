// Screen against source (5 Oct 2026): what the app's Jobs list holds must be what Notion holds, job for job. Pure: the suite reads both, this compares.
// A wrong count or a score that differs from its row is a wrong result a screenshot cannot prove; this makes it exact.
const key = url => String(url || '').trim().replace(/\/$/, '');

// A row scored under 50 may be left out of the list on purpose (it is not shown anyway), so only one at 50 or more must be there.
// appJobs: [{url, title, fit}] from the app's list; rows: Notion Job Matches pages. -> [problem sentences], empty when they agree.
// appJobs: the Jobs list's scored jobs; matches: the store's Job Matches records (ctx.data('matches', 'list'): {url, title, fit, status}, on any store).
export function compareJobs(appJobs, matches) {
  const stored = new Map(matches.map(match => [key(match.url), match]));
  const problems = [];
  for (const job of appJobs) {
    const match = stored.get(key(job.url));
    if (!match) { problems.push(`"${job.title}" is in the Jobs list with a score but has no Job Matches record in the store`); continue; }
    const score = match.fit === '' || match.fit == null ? null : Number(match.fit);
    if (score != null && Number(job.fit) !== score) problems.push(`"${job.title}" shows fit ${job.fit} but its Job Matches record says ${score}`);
  }
  const listed = new Set(appJobs.map(job => key(job.url)));
  for (const [url, match] of stored) if (url && !listed.has(url) && match.status !== 'Dismissed' && !(Number(match.fit) < 50)) problems.push(`"${match.title || url}" is a Job Matches record in the store but is missing from the Jobs list`);
  return problems;
}

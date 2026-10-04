// Screen against source (5 Oct 2026): what the app's Jobs list holds must be what Notion holds, job for job. Pure: the suite reads both, this compares.
// A wrong count or a score that differs from its row is a wrong result a screenshot cannot prove; this makes it exact.
const key = url => String(url || '').trim().replace(/\/$/, '');

// A row scored under 50 may be left out of the list on purpose (it is not shown anyway), so only one at 50 or more must be there.
// appJobs: [{url, title, fit}] from the app's list; rows: Notion Job Matches pages. -> [problem sentences], empty when they agree.
export function compareJobs(appJobs, rows) {
  const notion = new Map(rows.map(row => [key(row.properties?.['Job URL']?.url), row]));
  const problems = [];
  for (const job of appJobs) {
    const row = notion.get(key(job.url));
    if (!row) { problems.push(`"${job.title}" is in the Jobs list with a score but has no Job Matches row in Notion`); continue; }
    const score = row.properties?.Score?.number;
    if (score != null && Number(job.fit) !== Number(score)) problems.push(`"${job.title}" shows fit ${job.fit} but its Notion row says ${score}`);
  }
  const listed = new Set(appJobs.map(job => key(job.url)));
  for (const [url, row] of notion) if (url && !listed.has(url) && row.properties?.Status?.select?.name !== 'Dismissed' && !(row.properties?.Score?.number < 50)) problems.push(`"${row.properties?.Job?.title?.[0]?.plain_text || url}" is a Job Matches row in Notion but is missing from the Jobs list`);
  return problems;
}

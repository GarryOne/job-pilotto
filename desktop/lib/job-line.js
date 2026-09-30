// The job a Logged activity run created or updated, from the engine's output line (dependency-free: pipeline.js and
// run-history.js both read it). The engine prints "Job logged: {…}" (src/notion/cron_runs.py log_job) and fills the
// run row's Application relation. Returns {pageId, url (its Notion page), title, jobUrl, created} or null.
export function jobFrom(lines) {
  const line = [...(lines || [])].reverse().find(entry => /^Job logged: \{/.test(entry));
  try {
    const job = JSON.parse(line.slice('Job logged: '.length));
    return job.page_id ? {pageId: job.page_id, url: job.url, title: job.title || '', jobUrl: job.job_url || '', created: !!job.created} : null;
  } catch { return null; }
}

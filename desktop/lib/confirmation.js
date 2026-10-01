// A Greenhouse or Lever confirmation page is a submission. The 3-hour watcher
// (tools/wait-and-mark-applied.sh) misses one that appears later, and the extension's
// own check misses it once the tab's saved job is gone. The app already receives every
// open job-site URL (POST /extension/tabs). This matches those URLs to an open session.
// Page text such as "thank you for applying" is not a submission (1 Oct 2026).

export function jobId(url) {
  let path = '';
  try { path = new URL(String(url)).pathname; } catch { return ''; }
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (['confirmation', 'thanks', 'application', 'apply'].includes(parts.at(-1))) parts.pop();
  return parts.at(-1) || '';
}

// The tab is this job's own confirmation page: same site, same job id, and the path ends
// in /confirmation (Greenhouse) or /thanks (Lever). The form page itself does not count.
export function confirmsJob(tabUrl, jobUrl) {
  if (!tabUrl || !jobUrl) return false;
  let tab;
  let job;
  try { tab = new URL(String(tabUrl)); job = new URL(String(jobUrl)); } catch { return false; }
  if (tab.origin !== job.origin) return false;
  const id = jobId(jobUrl);
  if (!id || jobId(tabUrl) !== id) return false;
  const last = tab.pathname.replace(/\/+$/, '').split('/').filter(Boolean).at(-1);
  return last === 'confirmation' || last === 'thanks';
}

// Session URLs a reported tab list has confirmed. Already-submitted sessions are skipped.
export function confirmationsToMark(tabUrls, sessions) {
  const marked = new Set();
  const urls = [];
  for (const session of sessions || []) {
    const url = String(session?.url || '');
    if (!url || session.outcome === 'submitted' || marked.has(url)) continue;
    if ((tabUrls || []).some(tab => confirmsJob(tab, url))) {
      marked.add(url);
      urls.push(url);
    }
  }
  return urls;
}

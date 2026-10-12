// Where a posting's application form lives and whether a reported page is that form: ONE rule for opening a tab (apply.js) and for knowing whose tab it is (review.js,
// journey-identity). Moved out of apply.js 12 Oct 2026 so the page-to-session match uses the same rule as the opener. Guards: test/review.test.js, test/app-apply.test.js.

// Tier 1: where the application form lives for a known site, when the posting page only has an "Apply" button in front of it.
// Ashby: <posting>/application, Lever: <posting>/apply, Workable: <posting>/apply. Anything else (or a URL already there) opens as it is.
export function formUrl(url) {
  let parsed;
  try { parsed = new URL(String(url).split('#')[0]); } catch { return String(url || ''); }
  const path = parsed.pathname.replace(/\/+$/, '');
  const host = parsed.hostname.toLowerCase();
  const to = suffix => `${parsed.origin}${path}${suffix}${parsed.search}`;
  if (host === 'jobs.ashbyhq.com' && /^\/[^/]+\/[0-9a-f-]{36}$/i.test(path)) return to('/application');
  if (host === 'jobs.lever.co' && /^\/[^/]+\/[0-9a-f-]{36}$/i.test(path)) return to('/apply');
  if (host === 'apply.workable.com' && /^\/[^/]+\/j\/[0-9A-Za-z]+$/.test(path)) return to('/apply');
  return String(url).split('#')[0];
}

// Is this URL (a page the extension reported) the form of that job's posting: the posting itself, its direct form link, or a
// page below it. Exact on the job, unlike the page-to-session match, so a stuck report never lands on another job at the same company.
export function isFormOf(reported, posting) {
  const key = url => String(url || '').split('#')[0].replace(/\/+$/, '');
  const [page, job] = [key(reported), key(posting)];
  return !!page && !!job && (page === job || page === key(formUrl(posting)) || page.startsWith(`${job}/`));
}

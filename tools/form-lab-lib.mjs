// The form lab's decisions, kept apart from the browser so they can be tested (tools/form-lab.mjs runs them).
// The lab visits PUBLIC application forms with a test applicant and never submits (docs: Notion "Self-improving form filling").

// The page that holds the form: Ashby and Lever keep it one level below the posting.
export function applicationUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (parsed.hostname === 'jobs.ashbyhq.com' && !/\/application$/.test(path)) parsed.pathname = `${path}/application`;
    else if (parsed.hostname === 'jobs.lever.co' && !/\/apply$/.test(path)) parsed.pathname = `${path}/apply`;
    parsed.hash = '';
    return parsed.href;
  } catch { return ''; }
}
// A short name for the board a form is on, which is also what the site stores.
export function siteOf(url) {
  try {
    const host = new URL(url).hostname;
    const known = [['greenhouse', /greenhouse\.io$/], ['ashby', /ashbyhq\.com$/], ['lever', /lever\.co$/], ['workable', /workable\.com$/],
      ['smartrecruiters', /smartrecruiters\.com$/], ['recruitee', /recruitee\.com$/], ['personio', /personio\.(de|com)$/], ['teamtailor', /teamtailor\.com$/]];
    return known.find(([, pattern]) => pattern.test(host))?.[0] || host;
  } catch { return ''; }
}

// The answer the test applicant gives a control, from the choices it offers: Yes for a yes/no, else the first choice; a date.
export function testAnswer(kind, options = []) {
  if (kind === 'date') return '2026-11-01';
  const clean = options.map(text => String(text || '').trim()).filter(Boolean);
  return clean.find(text => /^yes$/i.test(text)) || clean[0] || '';
}

// One row per control for the site: {site, fingerprint, kind, recipe, ok, why}. `results` are the operators' results.
export function runsFrom(site, results) {
  return (results || []).filter(result => result?.fp).map(result => ({site, fingerprint: result.fp, kind: result.kind, recipe: result.recipe || 0,
    ok: !!result.ok, why: result.ok ? '' : String(result.why || 'failed').slice(0, 80)}));
}

// A candidate recipe earns a canary when it worked, on enough different pages and enough tries. Not otherwise.
export const PROMOTE_MIN_PAGES = 3, PROMOTE_MIN_TRIES = 5, PROMOTE_MIN_RATE = 0.9;
export function decidePromotion(tries) {
  const list = Array.isArray(tries) ? tries : [];
  const ok = list.filter(item => item.ok).length;
  const pages = new Set(list.filter(item => item.ok).map(item => item.page));
  const rate = list.length ? ok / list.length : 0;
  return {promote: list.length >= PROMOTE_MIN_TRIES && pages.size >= PROMOTE_MIN_PAGES && rate >= PROMOTE_MIN_RATE, tries: list.length, ok, pages: pages.size, rate};
}

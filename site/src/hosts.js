// The site's hosts. workers.dev is canonical for installed apps and old engine tags and is never redirected; jobpilotto.top is a
// replaceable alias (owner, 10 Oct 2026): its bare name sends people to www, nothing on workers.dev changes. Guarded by test/hosts.test.js.
export const ALIAS_APEXES = ['jobadabra.top', 'jobpilotto.top'];   // jobadabra.top: the new main address (19 Oct 2026)

// Static pages are served by Workers Assets before this code runs, so the zone's Cloudflare Redirect Rule (<apex>/* -> www, 301, query kept)
// does the redirect for them; this covers the paths the worker answers itself. Neither touches workers.dev.
// A request to the bare alias domain -> a 301 to the same path on www; any other host (workers.dev, www.jobpilotto.top) -> null.
export function apexRedirect(request) {
  const url = new URL(request.url);
  if (!ALIAS_APEXES.includes(url.hostname)) return null;
  url.hostname = `www.${url.hostname}`;
  return Response.redirect(url.toString(), 301);
}

// Our own hosts, www stripped: a referrer from any of them is the site linking to itself (src/stats.js sourceOf).
export const OWN_HOSTS = [...ALIAS_APEXES, 'jobpilotto.workers.dev'];

// The main address is www.jobadabra.top (owner, 19 Oct 2026). The old name keeps answering for ever: installed apps and the engine call
// www.jobpilotto.top/api/*, /report/*, /telemetry with POSTs and auth headers, which a redirect would break. Only the human pages move:
// a GET of a page on the old hosts -> 301 to the same path on www.jobadabra.top, query kept. wrangler.toml's run_worker_first lists the same
// paths (static pages are otherwise served before this code runs); test/hosts.test.js fails when a page in public/ is missing from either.
export const MAIN_HOST = 'www.jobadabra.top';
export const LEGACY_HOSTS = ['www.jobpilotto.top'];   // the bare jobpilotto.top goes through apexRedirect first
export const PAGE_PATHS = ['/', '/changelog', '/compare', '/coverage', '/download', '/faq', '/features', '/friends', '/how-it-works', '/intelligence', '/platforms', '/pricing', '/privacy', '/ready-live', '/research', '/terms', '/trust'];
export function legacyPageRedirect(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (!LEGACY_HOSTS.includes(url.hostname)) return null;
  const path = url.pathname.replace(/\.html$/, '').replace(/^\/index$/, '/');
  if (!PAGE_PATHS.includes(path)) return null;
  url.hostname = MAIN_HOST;
  url.pathname = path;
  return Response.redirect(url.toString(), 301);
}

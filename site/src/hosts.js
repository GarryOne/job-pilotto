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

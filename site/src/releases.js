// The app's update check (desktop/lib/updater.js) reads the releases here, not from api.github.com: GitHub allows 60 unsigned
// calls an hour per IP, and an office network shares one (9 Oct 2026: a friend's Windows app got "GitHub answered 403").
// Two fixed reads only, made with the site's GITHUB_TOKEN and kept 5 minutes at the edge for every install; the answer is the
// GitHub shape, trimmed to the fields the updater reads. Guard: site/test/releases.test.js.
const REPO = 'GarryOne/job-pilotto';
const PATHS = {'/api/releases/latest': `repos/${REPO}/releases/latest`, '/api/releases': `repos/${REPO}/releases?per_page=30`};
export const CACHE_SECONDS = 300;

export const isReleasesPath = pathname => Object.hasOwn(PATHS, pathname);

const trim = release => release && {tag_name: release.tag_name, name: release.name, body: release.body, html_url: release.html_url,
  prerelease: !!release.prerelease, draft: !!release.draft,
  assets: (release.assets || []).map(item => ({name: item.name, browser_download_url: item.browser_download_url, size: item.size}))};

export async function releases(request, env, ctx, {fetcher = globalThis.fetch, cache = globalThis.caches?.default} = {}) {
  const {pathname} = new URL(request.url);
  if (request.method !== 'GET') return new Response('GET only', {status: 405});
  const key = new Request(new URL(pathname, request.url).toString());   // no query: one cached answer per path
  const kept = cache && await cache.match(key);
  if (kept) return kept;
  const response = await fetcher(`https://api.github.com/${PATHS[pathname]}`, {headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'job-pilotto-site',
    'X-GitHub-Api-Version': '2022-11-28', ...(env.GITHUB_TOKEN ? {Authorization: `Bearer ${env.GITHUB_TOKEN}`} : {})}});
  if (!response.ok) {
    console.log(`releases: GitHub answered ${response.status} for ${pathname}`);
    return Response.json({error: `GitHub answered ${response.status}`}, {status: 502, headers: {'Cache-Control': 'no-store'}});   // the app falls back to GitHub itself
  }
  const data = await response.json();
  const body = Array.isArray(data) ? data.map(trim) : trim(data);
  const answer = Response.json(body, {headers: {'Cache-Control': `public, max-age=${CACHE_SECONDS}`}});
  if (cache) ctx?.waitUntil?.(cache.put(key, answer.clone()));
  return answer;
}

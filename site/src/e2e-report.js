// The e2e run's HTML report on this site, kept ONLY because the E2E workflows print "/admin/e2e/run/<run>/report" on their GitHub run Summary page and in each suite's
// table (.github/workflows/e2e*.yml, desktop.yml, desktop/e2e/lib/step-summary.mjs). The /admin/e2e runs page itself was dropped on 15 Oct 2026 (owner: "not useful").
// /admin/e2e/run/<run>/report sends an admin to the run's Playwright report; /admin/e2e/report/<artifact>/<token>/<file> serves its files out of the e2e-report artifact
// (byte ranges, signed address). Nothing is stored; the GitHub token is the site's GITHUB_TOKEN. Tests: test/e2e-report.test.js.
import {same, sign, viewer} from './auth.js';

const REPORT = 'e2e-report';   // the run's merged Playwright HTML report (the workflows' report job)

const github = (env, path, fetcher, extra = {}) => fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {...extra, headers: {
  Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'job-pilotto-site', 'X-GitHub-Api-Version': '2022-11-28'}});
async function json(env, path, fetcher) {
  const response = await github(env, path, fetcher);
  if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]}: ${response.status}`);
  return response.json();
}

const reportName = os => (os ? `${REPORT}-windows` : REPORT);

// The files inside a zip (GitHub's artifact download), from its central directory: name -> {method, compressedSize, offset}. Stored (0) and deflated (8) entries.
export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new Error('not a zip');
  const entries = new Map();
  let at = view.getUint32(end + 16, true);
  for (let count = view.getUint16(end + 10, true); count > 0 && view.getUint32(at, true) === 0x02014b50; count--) {
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {method: view.getUint16(at + 10, true), compressedSize: view.getUint32(at + 20, true), offset: view.getUint32(at + 42, true)});
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
// One file's bytes as a stream (inflated when it was deflated).

// so a file is read with byte ranges (the zip's directory, then that file's bytes), never the whole artifact. The address carries a signed token for the artifact
// (/admin/e2e/report/<id>/<token>/<file>): the report's trace viewer fetches from a service worker, which must not depend on the login cookie. Only an admin is
// ever handed one (/admin/e2e/run/<run>/report checks first); artifacts never change, so files are cached a day.
const TYPES = {html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json', zip: 'application/zip', png: 'image/png', jpeg: 'image/jpeg',
  jpg: 'image/jpeg', svg: 'image/svg+xml', ttf: 'font/ttf', woff2: 'font/woff2', webmanifest: 'application/manifest+json', txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8'};
export const reportToken = (env, id) => sign(env.STATS_KEY, `e2e-report|${id}`);

async function ranged(fetcher, url, start, end) {
  const response = await fetcher(url, {headers: {Range: `bytes=${start}-${end}`}});
  if (response.status === 206) return response;
  if (response.ok) return new Response(new Blob([new Uint8Array(await response.arrayBuffer()).subarray(start, end + 1)]));   // no range support: cut it here
  throw new Error(`storage ${response.status}`);
}
// The artifact's signed storage address and size.
async function storage(env, id, fetcher) {
  const [meta, zip] = await Promise.all([json(env, `/actions/artifacts/${id}`, fetcher), github(env, `/actions/artifacts/${id}/zip`, fetcher, {redirect: 'manual'})]);
  const url = zip.headers.get('Location');
  if (!url || meta.expired) throw new Error(meta.expired ? 'this report has expired on GitHub' : `GitHub artifact ${id}: ${zip.status}`);
  return {url, size: meta.size_in_bytes};
}
// The zip's directory from its last bytes (the end record, then the central directory): name -> {method, compressedSize, offset}.
export async function remoteEntries(fetcher, url, size) {
  const tailStart = Math.max(0, size - 65557);
  const tail = new Uint8Array(await (await ranged(fetcher, url, tailStart, size - 1)).arrayBuffer());
  const view = new DataView(tail.buffer);
  let end = -1;
  for (let at = tail.length - 22; at >= 0; at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new Error('not a zip');
  const dirSize = view.getUint32(end + 12, true), dirOffset = view.getUint32(end + 16, true);
  const dir = dirOffset >= tailStart ? tail.subarray(dirOffset - tailStart, dirOffset - tailStart + dirSize) : new Uint8Array(await (await ranged(fetcher, url, dirOffset, dirOffset + dirSize - 1)).arrayBuffer());
  // zipEntries reads a whole zip; give it the directory and an end record pointing at offset 0.
  const record = new Uint8Array(22), rv = new DataView(record.buffer);
  rv.setUint32(0, 0x06054b50, true); rv.setUint16(8, view.getUint16(end + 8, true), true); rv.setUint16(10, view.getUint16(end + 10, true), true); rv.setUint32(12, dirSize, true);
  const whole = new Uint8Array(dir.length + 22); whole.set(dir); whole.set(record, dir.length);
  return zipEntries(whole);
}
async function remoteFile(fetcher, url, entry) {
  const header = new DataView(await (await ranged(fetcher, url, entry.offset, entry.offset + 29)).arrayBuffer());
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (!entry.compressedSize) return new Blob([]).stream();
  const body = (await ranged(fetcher, url, start, start + entry.compressedSize - 1)).body;
  if (entry.method === 0) return body;
  if (entry.method === 8) return body.pipeThrough(new DecompressionStream('deflate-raw'));
  throw new Error(`zip method ${entry.method}`);
}
const cache = () => (typeof caches === 'undefined' ? null : caches.default);
export async function reportFile(request, env, fetcher = fetch) {
  const match = new URL(request.url).pathname.match(/^\/admin\/e2e\/report\/(\d+)\/([\w-]{20,})\/(.*)$/);
  if (!match || !env.STATS_KEY || !same(match[2], await reportToken(env, match[1]))) return new Response('Not found', {status: 404});
  const file = decodeURIComponent(match[3] || 'index.html') || 'index.html';
  const key = new Request(`https://e2e-report.cache/${match[1]}/${encodeURIComponent(file)}`);
  const hit = await cache()?.match(key);
  if (hit) return hit;
  try {
    const {url, size} = await storage(env, match[1], fetcher);
    const entry = (await remoteEntries(fetcher, url, size)).get(file);
    if (!entry) return new Response('Not found', {status: 404});
    const response = new Response(await remoteFile(fetcher, url, entry), {headers: {'Content-Type': TYPES[file.split('.').pop().toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400', 'X-Robots-Tag': 'noindex'}});
    const put = cache();
    if (!put) return response;
    const [mine, theirs] = response.body.tee();
    put.put(key, new Response(theirs, response)).catch(() => {});
    return new Response(mine, response);
  } catch (error) {
    console.log('e2e report', error.message);
    return new Response(`The report could not be read: ${error.message}`, {status: 502});
  }
}

// /admin/e2e/run/<run>/report?suite=<name>: the run's report (a link the suites print on the run's Summary page before the report exists), or a page saying it is
// not built yet (refreshing itself while the run goes) or that this run has none.
export async function runReport(request, env, fetcher = fetch) {
  const url = new URL(request.url), run = url.pathname.match(/^\/admin\/e2e\/run\/(\d+)\/report$/)?.[1];
  if (!run) return new Response('Not found', {status: 404});
  const [info, artifacts] = await Promise.all([json(env, `/actions/runs/${run}`, fetcher), json(env, `/actions/runs/${run}/artifacts?per_page=100`, fetcher)]);
  // ?os=windows: the Windows gate's report (e2e-report-windows; a Windows run before 7 Oct 2026 named it e2e-report). A release run holds both.
  const live = (artifacts.artifacts || []).filter(item => !item.expired);
  const report = url.searchParams.get('os') === 'windows' ? live.find(item => item.name === reportName('Windows')) || live.find(item => item.name === REPORT) : live.find(item => item.name === REPORT);
  const suite = (url.searchParams.get('suite') || '').replace(/[^\w-]/g, '');
  if (report) return new Response(null, {status: 302, headers: {Location: `/admin/e2e/report/${report.id}/${await reportToken(env, report.id)}/index.html${suite ? `#?q=${encodeURIComponent(suite)}` : ''}`, 'Cache-Control': 'no-store'}});
  const going = info.status !== 'completed';
  const text = going ? 'The HTML report is built when the run ends. This page checks again every minute.' : 'This run has no HTML report: it predates the report, the report job failed, or GitHub has deleted it.';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>E2E report · Admin</title><style>body{margin:0;background:#0b0d10;color:#f4efe3;font:15px/1.5 system-ui,-apple-system,sans-serif}main{max-width:640px;margin:15vh auto;padding:0 16px}a{color:#f5b54a}</style></head>
<body><main><h1>${going ? '⏳' : '📊'} ${going ? 'Not ready yet' : 'No report'}</h1><p>${text}</p><p><a href="${info.html_url}">The run on GitHub</a> · <a href="/admin/self-healing">Admin</a></p></main>${going ? '<script>setInterval(function () { if (!document.hidden) location.reload(); }, 60000);</script>' : ''}</body></html>`,
  {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

// GET /admin/e2e (the page), ?json=1 (the runs), ?steps=<artifact> (a suite's steps.json), /admin/e2e/trace/<artifact>/<trace-file>.zip (for the viewer).

// /admin/e2e/run/<run>/report needs an admin and the site's GitHub token; any other /admin/e2e address (the old runs page, ?json, ?steps, traces) goes to the E2E tab, /admin/operations/e2e.
export async function view(request, env, fetcher = fetch) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const {pathname} = new URL(request.url);
  if (!/^\/admin\/e2e\/run\/\d+\/report$/.test(pathname)) return new Response(null, {status: 302, headers: {Location: '/admin/operations/e2e', 'Cache-Control': 'no-store'}});
  if (!env.GITHUB_TOKEN) return Response.json({error: 'GITHUB_TOKEN is not set on the site'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
  try { return await runReport(request, env, fetcher); } catch (error) {
    console.log('e2e report', error.message);
    return new Response(`The report could not be read: ${error.message}`, {status: 502});
  }
}

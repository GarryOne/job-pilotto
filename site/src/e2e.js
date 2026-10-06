// /admin/e2e: the end-to-end runs, read live from GitHub (owner, 6 Oct 2026: "I don't want to run npx playwright show-trace every time"). Every run of e2e.yml and
// e2e-windows.yml with its suites (running, passed, failed), each suite's steps, and a failed suite's Playwright trace opened in the viewer this site serves
// (public/trace-viewer/, Playwright's own). Nothing is stored here: the data is the run's `e2e-view-<suite>` artifact (steps.json + trace-*.zip, uploaded
// uncompressed by the workflows), kept by GitHub for its retention. Admins only (src/auth.js viewer); the GitHub token is the site's GITHUB_TOKEN.
import {same, sign, viewer} from './auth.js';
import {remember} from './stats.js';

const WORKFLOWS = [{file: 'e2e.yml', os: ''}, {file: 'e2e-windows.yml', os: 'Windows'}];
const NOT_SUITES = new Set(['plan', 'promote', 'promote-dry-run', 'Windows follows', 'approve-windows', 'HTML report', 'Windows HTML report']);
const RUNS = 10;
const REPORT = 'e2e-report';   // the run's merged Playwright HTML report (the workflows' report job)

const github = (env, path, fetcher, extra = {}) => fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {...extra, headers: {
  Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'job-pilotto-site', 'X-GitHub-Api-Version': '2022-11-28'}});
async function json(env, path, fetcher) {
  const response = await github(env, path, fetcher);
  if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]}: ${response.status}`);
  return response.json();
}
const seconds = (from, to) => (from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)) : null);

// A suite's job -> its row; its view artifact (steps.json, traces) is named after the suite: e2e-view-<suite> or e2e-view-windows-<suite>.
export function suiteRows(jobs = [], artifacts = [], os = '') {
  const views = new Map(artifacts.filter(item => !item.expired).map(item => [item.name, item.id]));
  return jobs.filter(job => !NOT_SUITES.has(job.name)).map(job => {
    const name = job.name.replace(/ \(Windows\)$/, '');
    return {name, status: job.status, conclusion: job.conclusion, seconds: seconds(job.started_at, job.completed_at), url: job.html_url,
      view: views.get(`e2e-view-${os ? 'windows-' : ''}${name}`) || null};
  }).sort((a, b) => (b.conclusion === 'failure') - (a.conclusion === 'failure') || a.name.localeCompare(b.name));   // failed first
}

// The last runs of both workflows, newest first, each with its suites.
export async function recentRuns(env, fetcher = fetch) {
  const lists = await Promise.all(WORKFLOWS.map(async ({file, os}) => ((await json(env, `/actions/workflows/${file}/runs?per_page=${RUNS}`, fetcher)).workflow_runs || []).map(run => ({run, os}))));
  const runs = lists.flat().sort((a, b) => Date.parse(b.run.created_at) - Date.parse(a.run.created_at)).slice(0, RUNS);
  return Promise.all(runs.map(async ({run, os}) => {
    const [jobs, artifacts] = await Promise.all([json(env, `/actions/runs/${run.id}/jobs?per_page=100`, fetcher), json(env, `/actions/runs/${run.id}/artifacts?per_page=100`, fetcher)]);
    return {id: run.id, title: String(run.display_title || '').replace(/\b([0-9a-f]{7})[0-9a-f]{33}\b/g, '$1'), os, event: run.event, sha: (run.head_sha || '').slice(0, 7), status: run.status, conclusion: run.conclusion,
      created: run.created_at, url: run.html_url, suites: suiteRows(jobs.jobs, artifacts.artifacts, os),
      report: (artifacts.artifacts || []).some(item => item.name === REPORT && !item.expired)};
  }));
}

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
export function zipFile(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new Blob([data]).stream();
  if (entry.method === 8) return new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  throw new Error(`zip method ${entry.method}`);
}

// An artifact of this repo, downloaded. GitHub answers with a redirect to a signed storage address, followed here without the token (it is GitHub's only).
async function artifact(env, id, fetcher) {
  let response = await github(env, `/actions/artifacts/${id}/zip`, fetcher, {redirect: 'manual'});
  const location = response.status >= 300 && response.status < 400 && response.headers.get('Location');
  if (location) response = await fetcher(location);
  if (!response.ok) throw new Error(`GitHub artifact ${id}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// The Playwright HTML report, served file by file out of the run's e2e-report artifact (6 Oct 2026). A report with traces and a screenshot per step is tens of MB,
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
  const report = (artifacts.artifacts || []).find(item => item.name === REPORT && !item.expired);
  const suite = (url.searchParams.get('suite') || '').replace(/[^\w-]/g, '');
  if (report) return new Response(null, {status: 302, headers: {Location: `/admin/e2e/report/${report.id}/${await reportToken(env, report.id)}/index.html${suite ? `#?q=${encodeURIComponent(suite)}` : ''}`, 'Cache-Control': 'no-store'}});
  const going = info.status !== 'completed';
  const text = going ? 'The HTML report is built when the run ends. This page checks again every 30 seconds.' : 'This run has no HTML report: it predates the report, the report job failed, or GitHub has deleted it.';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">${going ? '<meta http-equiv="refresh" content="30">' : ''}
<title>E2E report · Admin</title><style>body{margin:0;background:#0b0d10;color:#f4efe3;font:15px/1.5 system-ui,-apple-system,sans-serif}main{max-width:640px;margin:15vh auto;padding:0 16px}a{color:#f5b54a}</style></head>
<body><main><h1>${going ? '⏳' : '📊'} ${going ? 'Not ready yet' : 'No report'}</h1><p>${text}</p><p><a href="${info.html_url}">The run on GitHub</a> · <a href="/admin/e2e">All runs</a></p></main></body></html>`,
  {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

// GET /admin/e2e (the page), ?json=1 (the runs), ?steps=<artifact> (a suite's steps.json), /admin/e2e/trace/<artifact>/<trace-file>.zip (for the viewer).
export async function view(request, env, fetcher = fetch) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const noStore = {'Cache-Control': 'no-store'};
  const data = url.pathname !== '/admin/e2e' || url.searchParams.has('json') || url.searchParams.has('steps');
  if (data && !env.GITHUB_TOKEN) return Response.json({error: 'GITHUB_TOKEN is not set on the site'}, {status: 503, headers: noStore});   // the page itself still opens and says so
  try {
    const trace = url.pathname.match(/^\/admin\/e2e\/trace\/(\d+)\/(trace-[\w.-]+\.zip)$/);
    if (trace) {
      const bytes = await artifact(env, trace[1], fetcher), entry = zipEntries(bytes).get(trace[2]);
      if (!entry) return new Response('No such trace in this artifact', {status: 404});
      return new Response(zipFile(bytes, entry), {headers: {'Content-Type': 'application/zip', 'Cache-Control': 'private, max-age=86400'}});   // an artifact never changes
    }
    if (url.pathname.startsWith('/admin/e2e/run/')) return await runReport(request, env, fetcher);
    if (url.pathname !== '/admin/e2e') return new Response('Not found', {status: 404});
    const steps = url.searchParams.get('steps');
    if (steps) {
      if (!/^\d+$/.test(steps)) return new Response('Not found', {status: 404});
      const bytes = await artifact(env, steps, fetcher), entry = zipEntries(bytes).get('steps.json');
      if (!entry) return Response.json({results: [], traces: [], note: 'this run predates steps.json'}, {headers: noStore});
      return new Response(zipFile(bytes, entry), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=86400'}});
    }
    if (url.searchParams.has('json')) return Response.json({runs: await recentRuns(env, fetcher), now: new Date().toISOString()}, {headers: noStore});
  } catch (error) {
    console.log('e2e page', error.message);
    return Response.json({error: error.message}, {status: 502, headers: noStore});
  }
  return new Response(PAGE, {headers: {'Content-Type': 'text/html; charset=utf-8', ...noStore}});
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>E2E runs · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--green:#5ec47a;--red:#e5484d}
*{box-sizing:border-box}.live{font-size:13px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted);margin-right:6px}
.live.on .dot{background:var(--green);animation:pulse 2s infinite}@keyframes pulse{50%{opacity:.35}}
.card{padding:14px 16px;margin-bottom:12px}.run-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.run-head b{flex:1;min-width:200px}
.meta{font-size:12px;color:var(--muted)}details{border-top:1px solid var(--line);padding:6px 0}details:first-of-type{margin-top:10px}
summary{cursor:pointer;display:flex;gap:10px;align-items:baseline;list-style:none}summary::-webkit-details-marker{display:none}
.repeat{border:0;padding:2px 0}.repeat summary{color:var(--muted);font-size:13px}.repeat summary::before,.passed>summary .name::after{content:' ▸';color:var(--amber)}.passed>summary .name{color:var(--muted)}.passed[open]>summary .name::after{content:' ▾'}.passed>details{padding-left:0}
summary .name{flex:1}td,th{padding:5px 8px 5px 0;vertical-align:top;font-size:13px}td.what{overflow-wrap:anywhere}
.steps{margin:8px 0 4px 22px}.button{display:inline-block;margin:6px 8px 0 0;padding:6px 12px;border-radius:999px;background:var(--amber);color:#0b0d10;font-weight:600;text-decoration:none;font-size:13px}
.failed{color:var(--red)}
</style></head><body><main>
<header><h1>🧪 E2E runs</h1><span class="live" id="live"><span class="dot"></span><span id="state">connecting…</span></span></header>
<p class="muted">The last runs of the end-to-end suites, live from GitHub. Open a suite for its steps; a failed suite has its trace: every action, the page before and after, console and network.</p>
<div id="list"><p class="muted">Loading…</p></div>
<script>
const list = document.getElementById('list'), state = document.getElementById('state'), live = document.getElementById('live');
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node; };
const icon = item => item.status !== 'completed' ? (item.status === 'in_progress' ? '⏳' : '🕒') : ({success: '✅', failure: '❌', cancelled: '⏹️', skipped: '⏭️'}[item.conclusion] || '⚪');
const ago = at => { const m = Math.round((Date.now() - Date.parse(at)) / 60000); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
const time = s => s == null ? '' : s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
const opened = new Map(), loaded = new Map();
async function steps(id, box) {
  if (!loaded.has(id)) loaded.set(id, fetch('?steps=' + id).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status))));
  try {
    const data = await loaded.get(id);
    const row = r => el('tr', {}, el('td', {textContent: {passed: '✅', failed: '❌', skipped: '⏭️'}[r.status] || ''}), el('td', {textContent: r.name}),
      el('td', {textContent: r.seconds ? Math.round(r.seconds) + ' s' : ''}), el('td', {className: 'what' + (r.status === 'failed' ? ' failed' : ''), textContent: r.note || (r.retried ? 'passed after one retry' : '')}));
    // One error repeated by step after step (a closed window): the first one shows, the rest behind one line.
    const cause = r => r.status === 'failed' ? String(r.note || '').replace(/^[\w.$]+: /, '') : null, results = data.results || [], rows = [];
    for (let i = 0; i < results.length; i++) {
      const same = [];
      while (cause(results[i]) && i + same.length + 1 < results.length && cause(results[i + same.length + 1]) === cause(results[i])) same.push(results[i + same.length + 1]);
      rows.push(row(results[i]));
      if (same.length >= 2) {
        rows.push(el('tr', {}, el('td', {}), el('td', {colSpan: 3}, el('details', {className: 'repeat'}, el('summary', {textContent: same.length + ' more steps failed the same way'}),
          el('table', {}, ...same.map(row))))));
        i += same.length;
      }
    }
    const traces = (data.traces || []).map(file => el('a', {className: 'button', target: '_blank', textContent: '▶ Open trace' + (data.traces.length > 1 ? ' (' + file + ')' : ''),
      href: '/trace-viewer/index.html?trace=' + encodeURIComponent(location.origin + '/admin/e2e/trace/' + id + '/' + file)}));
    box.replaceChildren(rows.length ? el('table', {}, el('tr', {}, el('th', {textContent: ''}), el('th', {textContent: 'Step'}), el('th', {textContent: 'Time'}), el('th', {textContent: 'What happened'})), ...rows)
      : el('p', {className: 'muted', textContent: data.note || 'No step ran.'}), ...traces);
  } catch (error) { loaded.delete(id); box.textContent = 'Could not read the steps (' + error.message + ').'; }
}
function suite(run, s) {
  const key = run.id + '/' + s.name, box = el('div', {className: 'steps'});
  const details = el('details', {}, el('summary', {}, el('span', {textContent: icon(s)}), el('span', {className: 'name', textContent: s.name}),
    el('span', {className: 'meta', textContent: time(s.seconds)}), el('a', {href: s.url, target: '_blank', className: 'meta', textContent: 'log'})), box);
  if (!s.view) box.append(el('p', {className: 'muted', textContent: s.status === 'completed' ? 'No steps file for this suite (an older run, or it stopped before writing one).' : 'Running: its steps appear when it ends.'}));
  details.open = opened.get(key) ?? s.conclusion === 'failure';   // a failed suite opens by itself; what you opened or closed stays so across refreshes
  details.addEventListener('toggle', () => { opened.set(key, details.open); if (details.open && s.view) steps(s.view, box); });
  if (details.open && s.view) steps(s.view, box);
  return details;
}
function card(run) {
  const failed = run.suites.filter(s => s.conclusion === 'failure').length;
  return el('div', {className: 'card'}, el('div', {className: 'run-head'}, el('span', {textContent: icon(run)}), el('b', {textContent: run.title + (run.os ? ' · ' + run.os : '')}),
    el('span', {className: 'meta', textContent: run.suites.length + ' suites' + (failed ? ', ' + failed + ' failed' : '') + ' · ' + run.event + ' · ' + run.sha + ' · ' + ago(run.created)}),
    ...(run.report ? [el('a', {href: '/admin/e2e/run/' + run.id + '/report', target: '_blank', className: 'button', textContent: '📊 HTML report'})] : []),
    el('a', {href: run.url, target: '_blank', className: 'meta', textContent: 'GitHub'})), ...suites(run));
}
// Suites that need a look (failed, running) one by one; the passed ones under one line, closed: "✅ 19 passed — show".
function suites(run) {
  const passed = run.suites.filter(s => s.conclusion === 'success'), rest = run.suites.filter(s => s.conclusion !== 'success');
  if (passed.length < 2) return run.suites.map(s => suite(run, s));
  const key = run.id + '/passed', group = el('details', {className: 'passed'}, el('summary', {}, el('span', {textContent: '✅'}),
    el('span', {className: 'name', textContent: passed.length + ' passed — show'})), ...passed.map(s => suite(run, s)));
  group.open = opened.get(key) ?? false;
  group.addEventListener('toggle', () => opened.set(key, group.open));
  return [...rest.map(s => suite(run, s)), group];
}
let timer;
async function refresh() {
  clearTimeout(timer);
  let running = false;
  try {
    const response = await fetch('?json=1', {cache: 'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.status);
    running = data.runs.some(run => run.status !== 'completed');
    list.replaceChildren(...(data.runs.length ? data.runs.map(card) : [el('p', {className: 'muted', textContent: 'No end-to-end runs yet.'})]));
    state.textContent = (running ? 'live · a run is in progress' : 'up to date') + ' · ' + new Date().toLocaleTimeString();
    live.classList.toggle('on', running);
  } catch (error) { state.textContent = 'GitHub did not answer (' + error.message + '), retrying…'; live.classList.remove('on'); }
  timer = setTimeout(refresh, running ? 30000 : 120000);   // every 30 s while a run is going, else every 2 min
}
refresh();
</script></main></body></html>`;

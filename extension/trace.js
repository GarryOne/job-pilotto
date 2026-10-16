// The form trace (spec docs/superpowers/specs/2026-10-16-report-from-the-trace.md §1-§2): on a tab the app opened, from the job posting on, it keeps every response the page gets (address, status,
// timing, content type, location, body) through Chrome's debugger Network events, IN MEMORY ONLY (trace-buffer.js), so "Report this form" can hand it over at once, with no reload.
// It never reads request bodies, request headers or cookies. A page with a password field is never kept: that page is dropped whole, the debugger is released while it is shown (Chrome's bar goes
// away there) and the trace goes on after it. It shares the one debugger attachment with the fill's clicks (stop-state.js). Off when the Settings switch is off: no attach, no bar.
// Guards: desktop/test/trace.test.js, trace-buffer.test.js, trace-debugger.test.js.
import {attachDebugger, detachDebugger, forgetDebuggerUsers, isStopped} from './stop-state.js';
import {createBuffer} from './trace-buffer.js';

const KEEP_HEADER = /^(content-type|location|access-control-.*)$/i;   // the response headers a record holds (net-keep.js KEEP_HEADER)
const TYPES = {Document: 'document', Script: 'script', Stylesheet: 'stylesheet', Image: 'image', Font: 'font', Media: 'media', XHR: 'xhr', Fetch: 'fetch', Ping: 'ping'};
const TEXTUAL = new Set(['document', 'script', 'stylesheet', 'font', 'xhr', 'fetch', 'ping']);   // an image or media body is blanked or dropped by the scrub anyway: never read
const WATCH_MS = 1000;

export function createTrace({chrome, attach = attachDebugger, detach = detachDebugger, stopped = isStopped, now = Date.now, hasPassword = async () => false, enabled = async () => true,
  setTimer = setTimeout, clearTimer = clearTimeout, buffer = createBuffer({now}), onChange = () => {}}) {
  const runs = new Map();   // tab id -> the live capture of that tab

  const send = (tabId, method, params) => chrome.debugger.sendCommand({tabId}, method, params);
  const pick = headers => Object.fromEntries(Object.entries(headers || {}).filter(([name]) => KEEP_HEADER.test(name)).map(([name, value]) => [name.toLowerCase(), String(value)]));
  const fetchMode = headers => String((headers || {})['Sec-Fetch-Mode'] || (headers || {})['sec-fetch-mode'] || '');   // the one request header read: it tells a beacon from a page's own call

  function finish(run, request, failed) {
    run.pending.delete(request.id);
    if (run.requests.get(request.id) === request) run.requests.delete(request.id);   // a finished request's body lives in the buffer only (and is evicted there)
    const reply = request.status > 0;
    const entry = {method: request.method, url: request.url, type: request.type, mode: request.mode, startMs: request.began - run.t0, waitMs: now() - request.began, bodyKey: '',
      status: request.status, failed: failed && !reply, headers: request.headers, hadCookie: false, body: request.body ?? null, size: request.size ?? 0};
    buffer.add(run.tabId, entry, request.body ? request.body.length : 0);
  }

  async function onFinished(run, request, encoded) {
    try {
      if (!TEXTUAL.has(request.type)) throw new Error('not read');
      const {body, base64Encoded} = await send(run.tabId, 'Network.getResponseBody', {requestId: request.id});
      const text = base64Encoded ? body : btoa(unescape(encodeURIComponent(body)));
      request.body = text; request.size = Math.floor(text.length * 3 / 4);
    } catch { request.body = null; request.size = Math.floor(encoded || 0); }   // a redirect, a cached reply or an image: the entry is kept without a body
    if (runs.get(run.tabId) === run && !run.paused) finish(run, request, false);
  }

  function onEvent(source, method, params) {
    const run = runs.get(source.tabId);
    if (!run || run.paused) return;
    if (method === 'Page.frameNavigated') { if (!params.frame.parentId) { run.top = params.frame.id; run.shown = buffer.current(run.tabId); } return; }
    if (method === 'Network.requestWillBeSent') {
      if (!/^https?:/i.test(params.request.url)) return;
      const old = run.requests.get(params.requestId);
      if (params.redirectResponse && old) { old.status = params.redirectResponse.status; old.headers = pick(params.redirectResponse.headers); finish(run, old, false); }
      // A top-level navigation (not a redirect, not a frame inside the page) starts the next page of the application.
      else if (params.type === 'Document' && params.requestId === params.loaderId && (!run.top || params.frameId === run.top)) buffer.page(run.tabId);
      run.requests.set(params.requestId, {id: params.requestId, method: params.request.method, url: params.request.url, type: TYPES[params.type] || 'other', mode: fetchMode(params.request.headers),
        began: now(), status: 0, headers: {}});
      run.pending.add(params.requestId);
    } else if (method === 'Network.responseReceived') {
      const request = run.requests.get(params.requestId);
      if (request) { request.status = params.response.status; request.headers = pick(params.response.headers); }
    } else if (method === 'Network.loadingFinished') {
      const request = run.requests.get(params.requestId);
      if (request && run.pending.has(request.id)) onFinished(run, request, params.encodedDataLength);
    } else if (method === 'Network.loadingFailed') {
      const request = run.requests.get(params.requestId);
      if (request && run.pending.has(request.id)) finish(run, request, true);
    }
  }
  chrome.debugger.onEvent.addListener(onEvent);

  // A sign-in page is never kept: it and everything after its navigation are dropped, the debugger is let go of (no bar on the page), the gap is marked.
  function pause(run) {
    buffer.dropFrom(run.tabId, run.shown);
    run.paused = true; run.requests.clear(); run.pending.clear();
    if (run.held) { run.held = false; detach(run.tabId).catch(() => {}); }
    onChange(run.tabId);
  }
  async function resume(run) {
    try { await attach(run.tabId); } catch { return end(run.tabId); }
    run.held = true;
    try { await send(run.tabId, 'Network.enable'); await send(run.tabId, 'Page.enable'); } catch { return end(run.tabId); }
    run.paused = false; run.shown = null;
  }
  const watch = run => {
    run.watch = setTimer(async () => {
      if (runs.get(run.tabId) !== run) return;
      if (stopped()) { end(run.tabId); return; }
      const password = await hasPassword(run.tabId).catch(() => false);
      if (runs.get(run.tabId) !== run) return;
      if (password && !run.paused) pause(run);
      else if (!password && run.paused) await resume(run);
      if (runs.get(run.tabId) === run) watch(run);
    }, WATCH_MS);
  };

  function end(tabId) {   // the application ended, the tab closed, Stop, the switch went off: the trace is gone
    const run = runs.get(tabId);
    runs.delete(tabId); buffer.drop(tabId);
    if (!run) return;
    clearTimer(run.watch);
    if (run.held) detach(tabId).catch(() => {});
    onChange(tabId);
  }

  return {
    isTracing: tabId => runs.has(tabId),
    has: tabId => buffer.has(tabId),
    pageCount: tabId => buffer.pageCount(tabId),
    bytes: tabId => buffer.bytes(tabId),
    // The tab is (about to be) an application's page: start keeping its trace once. -> whether it is tracing
    async start(tabId) {
      if (runs.has(tabId)) return true;
      if (stopped() || !(await enabled().catch(() => false)) || runs.has(tabId)) return runs.has(tabId);
      const run = {tabId, t0: now(), requests: new Map(), pending: new Set(), top: null, shown: null, paused: false, held: false};
      runs.set(tabId, run);
      try {
        await attach(tabId);   // the one place the debugger is attached (stop-state.js): never while the person pressed Stop, and only on a tab the app opened
        run.held = true;
        await send(tabId, 'Network.enable');
        await send(tabId, 'Page.enable');
        run.top = (await send(tabId, 'Page.getFrameTree').catch(() => null))?.frameTree?.frame?.id || null;
      } catch { run.held = false; end(tabId); return false; }
      if (await hasPassword(tabId).catch(() => false)) pause(run);
      watch(run);
      onChange(tabId);
      return true;
    },
    // A navigation began on the tab: a trace paused on a sign-in page picks up again before the next page's first request.
    async navigating(tabId) { const run = runs.get(tabId); if (run?.paused) { if (await hasPassword(tabId).catch(() => true)) return; await resume(run); } },
    // -> {ok, entries, truncated} from memory, at once. scope: 'journey' | 'page'. Nothing is read from the page and the tab is not touched.
    snapshot(tabId, scope = 'journey') {
      if (!buffer.has(tabId)) return {ok: false, refused: runs.has(tabId) ? 'empty' : 'off'};
      return {ok: true, ...buffer.snapshot(tabId, scope)};
    },
    end,
    endAll() { for (const tabId of [...runs.keys()]) end(tabId); buffer.dropAll(); },
    // Chrome let go by itself (a closed tab, DevTools, the person's Cancel): nothing is held any more.
    detached(tabId) { forgetDebuggerUsers(tabId); const run = runs.get(tabId); if (run) { run.held = false; end(tabId); } },
  };
}

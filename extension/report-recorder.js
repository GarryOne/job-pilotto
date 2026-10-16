// The collector of "Report this form" (spec docs/superpowers/specs/2026-10-15-report-this-form.md §1): on ONE tab, from the person's press until Stop, it keeps every response the page gets
// (address, status, timing, content type, location, body) through Chrome's debugger Network events, in memory only. It never reads request bodies or cookies, presses nothing, and does nothing
// until start() is called (the reload happens there, on the person's press). A page with a password field ends the recording and keeps nothing. The result goes to the app, which scrubs it
// (desktop/lib/report-scrub.js), shows the person what would be sent and asks. Not wired to a button yet (the panel icon and the app's dialog come together, PR 4).
// Guard: desktop/test/report-recorder.test.js (also pins that this file never touches request bodies, cookies or request headers beyond the fetch mode).

import {attachDebugger, isStopped} from './stop-state.js';

const KEEP_HEADER = /^(content-type|location|access-control-.*)$/i;   // the response headers a record holds (net-keep.js KEEP_HEADER)
const TYPES = {Document: 'document', Script: 'script', Stylesheet: 'stylesheet', Image: 'image', Font: 'font', Media: 'media', XHR: 'xhr', Fetch: 'fetch', Ping: 'ping'};
const FLOOR = {maxBytes: 40e6, maxMs: 10 * 60e3, passwordEveryMs: 2000};

export function createRecorder({chrome, attach = attachDebugger, stopped = isStopped, now = Date.now, hasPassword = async () => false, setTimer = setTimeout, clearTimer = clearTimeout, limits = {}}) {
  const {maxBytes, maxMs, passwordEveryMs} = {...FLOOR, ...limits};
  let run = null;

  const send = (method, params) => chrome.debugger.sendCommand({tabId: run.tabId}, method, params);
  const pick = headers => Object.fromEntries(Object.entries(headers || {}).filter(([name]) => KEEP_HEADER.test(name)).map(([name, value]) => [name.toLowerCase(), String(value)]));
  const fetchMode = headers => String((headers || {})['Sec-Fetch-Mode'] || (headers || {})['sec-fetch-mode'] || '');   // the one request header read: it tells a beacon from a page's own call

  function finish(request, failed) {
    run.pending.delete(request.id);
    const ended = now(), reply = request.status > 0;
    const entry = {method: request.method, url: request.url, type: request.type, mode: request.mode, startMs: request.began - run.t0, waitMs: ended - request.began, bodyKey: '',
      status: request.status, failed: failed && !reply, headers: request.headers, hadCookie: false, body: request.body ?? null, size: request.size ?? 0};
    run.entries.push(entry);
  }

  async function onFinished(request) {
    try {
      const {body, base64Encoded} = await send('Network.getResponseBody', {requestId: request.id});
      const text = base64Encoded ? body : btoa(unescape(encodeURIComponent(body)));
      run.bytes += text.length;
      if (run.bytes > maxBytes) { run.truncated = true; request.body = null; }
      else { request.body = text; request.size = Math.floor(text.length * 3 / 4); }
    } catch { request.body = null; }   // a redirect or a cached reply has no body: the entry is kept without one
    finish(request, false);
  }

  function onEvent(source, method, params) {
    if (!run || run.refused || source.tabId !== run.tabId) return;
    if (method === 'Network.requestWillBeSent') {
      if (!/^https?:/i.test(params.request.url)) return;
      const old = run.requests.get(params.requestId);
      if (params.redirectResponse && old) { old.status = params.redirectResponse.status; old.headers = pick(params.redirectResponse.headers); finish(old, false); }
      run.requests.set(params.requestId, {id: params.requestId, method: params.request.method, url: params.request.url, type: TYPES[params.type] || 'other', mode: fetchMode(params.request.headers),
        began: now(), status: 0, headers: {}});
      run.pending.add(params.requestId);
    } else if (method === 'Network.responseReceived') {
      const request = run.requests.get(params.requestId);
      if (request) { request.status = params.response.status; request.headers = pick(params.response.headers); }
    } else if (method === 'Network.loadingFinished') {
      const request = run.requests.get(params.requestId);
      if (request && run.pending.has(request.id)) run.work.push(onFinished(request));
    } else if (method === 'Network.loadingFailed') {
      const request = run.requests.get(params.requestId);
      if (request && run.pending.has(request.id)) finish(request, true);
    }
  }

  async function end() {   // drops the listeners, the timers and the debugger; what was kept stays in `run` for the caller
    const current = run;
    clearTimer(current.timer); clearTimer(current.watch);
    chrome.debugger.onEvent.removeListener(current.listener);
    await Promise.allSettled(current.work);
    await chrome.debugger.detach({tabId: current.tabId}).catch(() => {});
  }

  const watchPassword = () => {
    run.watch = setTimer(async () => {
      if (!run) return;
      if (stopped()) { run.refused = 'stopped'; run.entries = []; run.requests.clear(); return; }   // the person pressed Stop: nothing more is kept
      if (await hasPassword(run.tabId).catch(() => false)) { run.refused = 'login'; run.entries = []; run.requests.clear(); } else watchPassword();   // a sign-in page: what was kept is dropped at once
    }, passwordEveryMs);
  };

  return {
    isRecording: tabId => !!run && (tabId === undefined || run.tabId === tabId),
    // The person pressed: refuse on a sign-in page, else attach, listen and start the journey again. `restart` (messages-report.js) moves the tab to the job's posting so the recording holds
    // every page and redirect from there, as a recorded row does; without one the tab reloads (a session-bound page cannot be reloaded alone, 16 Oct 2026). -> {ok} or {ok: false, refused}
    async start(tabId, {restart = null} = {}) {
      if (run) return {ok: false, refused: 'busy'};
      if (await hasPassword(tabId).catch(() => false)) return {ok: false, refused: 'login'};
      run = {tabId, t0: now(), requests: new Map(), pending: new Set(), entries: [], work: [], bytes: 0, truncated: false, refused: null};
      run.listener = onEvent;
      chrome.debugger.onEvent.addListener(onEvent);
      run.timer = setTimer(() => { run.refused = run.refused || 'time'; }, maxMs);
      try {
        await attach(tabId);   // the one place the debugger is attached (stop-state.js): never while the person pressed Stop, and only on a tab the app opened
        await send('Network.enable');
        await send('Network.setCacheDisabled', {cacheDisabled: true});   // the reload asks for everything again: the replay needs every response
        await send('Page.enable');
        if (restart && await restart()) { /* the tab left for its posting */ } else await send('Page.reload', {ignoreCache: true});
      } catch (error) { await end(); run = null; return {ok: false, refused: 'debugger', error: String(error?.message || error).slice(0, 80)}; }
      watchPassword();
      return {ok: true};
    },
    // Stop and review (or Cancel with {keep: false}): detaches and hands over what was kept. A sign-in page or the time cap seen meanwhile = nothing kept. -> {ok, entries, truncated} or {ok: false, refused}
    async stop({keep = true} = {}) {
      if (!run) return {ok: false, refused: 'idle'};
      if (!run.refused && stopped()) run.refused = 'stopped';
      if (!run.refused && await hasPassword(run.tabId).catch(() => false)) run.refused = 'login';
      const current = run;
      await end(); run = null;
      if (current.refused === 'login' || current.refused === 'stopped' || !keep) return {ok: false, refused: current.refused || 'cancelled'};
      return {ok: true, entries: current.entries.sort((a, b) => a.startMs - b.startMs), truncated: current.truncated, timedOut: current.refused === 'time'};
    },
  };
}

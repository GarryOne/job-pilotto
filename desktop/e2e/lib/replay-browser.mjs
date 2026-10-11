// One browser with the real extension and N tabs at once for offline page replays (the journey gate's recorded cases; row replay builds on the same pool).
// Owns: the single catch-all route (registered before any tab navigates), the per-host AI answers, which requests and tabs belong to which case, and the scheduler.
// Guards: e2e/test/replay-browser.test.mjs (attribution, host overlap), e2e/test/recorded-pages.test.mjs (every case).
// A case's pages are served at their real addresses; every other address is a 404 and, besides that, resolves to nothing (real-extension.mjs offline: true).
// Isolation between tabs: told/asked/judged count only requests whose body names the case's host, notTold counts every request (a parallel tab can only add a failure, never hide
// one: a failure in parallel is run again alone by the caller), and two cases that share a host never run at the same time (their pages, and the extension's per-host state, would meet).
import {startRealExtension} from './real-extension.mjs';
import {answerFor, caseFiles, caseHosts, isExtensionPage, judgeCase} from './page-replay.mjs';

const pathKey = url => { const parsed = new URL(url); return `${parsed.host}${parsed.pathname}`.replace(/\/$/, ''); };
const hostOf = text => { try { return new URL(JSON.parse(text).url).host; } catch { return ''; } };

// Which of the live cases a request is for: the host of the url it names, else the first live case that answers that route (a request with no url: the case is unknown).
export function caseForRequest(live, route, sent) {
  const host = hostOf(sent);
  return live.find(state => state.hosts.includes(host)) || live.find(state => state.answer[route]);
}

// The cases that may start now, given the hosts of the ones running: in order, skipping a case whose host is taken (it waits for that tab to finish).
export function nextRunnable(queue, runningHosts) {
  const index = queue.findIndex(item => !caseHosts(item).some(host => runningHosts.has(host)));
  return index;
}

// -> {run, live, serve, close}: one browser, the stand-in answering by case. items: every case that may run in it (their AI routes are known up front).
export async function startReplayBrowser(items, {extensionDir} = {}) {
  const live = [];   // states of the cases running now: {item, hosts, answer, from, tabs: Set, opened: [pages], shared}
  const routes = [...new Set(items.flatMap(item => Object.keys(item.ai || {})))];
  const answer = Object.fromEntries(routes.map(route => [route, sent => { const state = caseForRequest(live, route, sent); return state?.answer[route] ? state.answer[route](sent) : {}; }]));
  const run = await startRealExtension({extensionDir, cv: items.some(item => item.cv !== false), allowAllSites: true, answer, offline: true});
  const files = new Map();   // pathKey -> html of every live case
  await run.context.route('**/*', route => {   // ONE route for the browser, before any tab navigates: a route added while another tab loads let a request out (example.ch, 11 Oct 2026)
    const url = route.request().url(), host = new URL(url).hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
    const body = files.get(pathKey(url));
    return body ? route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body}) : route.fulfill({status: 404, body: ''});
  });
  const everyOpened = [];   // [{page, at}] every non-extension tab opened since the browser started
  run.context.on('page', open => { if (!isExtensionPage(open)) everyOpened.push({page: open, at: Date.now()}); });

  // One case in its own tab: -> {name, ok, failures, seen}.
  async function runInTab(item) {
    const hosts = caseHosts(item), others = live.length;
    const state = {item, hosts, answer: answerFor(item), from: Date.now(), tabs: new Set(), shared: others > 0};
    if (others) for (const one of live) one.shared = true;
    for (const [key, html] of caseFiles(item)) files.set(key, html);
    live.push(state);
    const first = run.requests.length, tab = await run.context.newPage();
    const mine = () => run.requests.slice(first).filter(request => hosts.some(host => request.body.includes(host)));
    const ours = open => !isExtensionPage(open) && open !== run.page && (open === tab || state.shared === false || hosts.some(host => open.url().includes(host)) || !/^https?:/.test(open.url()));   // alone: every tab is the case's
    try {
      await tab.goto(`${item.pages[0].url}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
      const result = await judgeCase(item, {run, page: tab, pages: () => run.context.pages().filter(ours), mine: () => (state.shared ? mine() : run.requests.slice(first)),
        all: () => run.requests.slice(first), opened: () => everyOpened.filter(one => one.page !== tab && one.at >= state.from && ours(one.page)).length});   // the case's own tab is not one it opened (solo: the first tab, opened before the count starts)
      return {name: item.name, ...result};
    } finally {
      live.splice(live.indexOf(state), 1);
      for (const key of caseFiles(item).keys()) files.delete(key);
      await Promise.all(run.context.pages().filter(open => open !== run.page && !isExtensionPage(open) && (open === tab || hosts.some(host => open.url().includes(host)))).map(open => open.close().catch(() => {})));
    }
  }
  return {run, live, runInTab, close: () => run.close()};
}

// Every case in one browser, `tabs` at a time. -> results in the order of items: {name, ok, failures, seen}. A case that throws is a failure with the error as its reason.
export async function replayInTabs(items, {tabs = 4, extensionDir, onResult} = {}) {
  const browser = await startReplayBrowser(items, {extensionDir});
  const queue = [...items], results = new Map(), running = new Map();   // running: case name -> promise
  const hostsRunning = () => new Set([...running.keys()].flatMap(name => caseHosts(items.find(item => item.name === name))));
  try {
    while (queue.length || running.size) {
      for (let index = nextRunnable(queue, hostsRunning()); running.size < tabs && index >= 0; index = nextRunnable(queue, hostsRunning())) {
        const item = queue.splice(index, 1)[0];
        running.set(item.name, runInTab_(browser, item).then(result => { results.set(item.name, result); running.delete(item.name); onResult?.(result); }));
      }
      if (running.size) await Promise.race(running.values());
    }
    if (!(await browser.run.assertIsolated().catch(() => false))) for (const result of results.values()) result.failures.push('isolation'), result.ok = false;
  } finally { await browser.close(); }
  return items.map(item => results.get(item.name));
}
const runInTab_ = (browser, item) => browser.runInTab(item).catch(error => ({name: item.name, ok: false, failures: [`error: ${String(error?.message || error).slice(0, 200)}`], seen: {tabs: 0, opened: 0}}));

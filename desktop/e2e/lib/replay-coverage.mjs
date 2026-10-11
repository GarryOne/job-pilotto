// Which extension files a recorded case really runs code from (V8 function coverage over the DevTools protocol), for the affected-case map (e2e/recorded-case-map.json).
// Owns: the raw CDP client (Node's WebSocket; Playwright cannot attach to an extension's service worker) and the coverage of the worker and the pages. Used by e2e/replay-map.mjs only;
// the browser must have been started with `cdp: true` (lib/real-extension.mjs). A file counts as USED when a named function in it ran (the module's own top level runs for every case).
import fs from 'node:fs';
import path from 'node:path';

export async function connect(profileDir, {timeoutMs = 10000} = {}) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  for (const deadline = Date.now() + timeoutMs; !fs.existsSync(file) && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 100));
  const [port, browserPath] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('devtools socket')); });
  let id = 0; const waiting = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); const call = waiting.get(message.id); if (call) { waiting.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { id += 1; waiting.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})})); });
  return {send, close: () => socket.close()};
}

// Starts precise function coverage in the extension's service worker and in every page; stop() -> Set of files (relative to the extension folder) a named function ran in.
export async function startCoverage(cdp, extensionId) {
  const sessions = new Map();   // targetId -> sessionId
  const attach = async target => {
    if (sessions.has(target.targetId) || !(target.type === 'service_worker' ? target.url.startsWith(`chrome-extension://${extensionId}/`) : target.type === 'page')) return;
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: true});
    sessions.set(target.targetId, sessionId);
    await cdp.send('Profiler.enable', {}, sessionId);
    await cdp.send('Profiler.startPreciseCoverage', {callCount: true, detailed: false}, sessionId);
  };
  const refresh = async () => { for (const target of (await cdp.send('Target.getTargets')).targetInfos) await attach(target).catch(() => {}); };
  await refresh();
  const used = new Set();
  const take = async () => {
    for (const sessionId of sessions.values()) {
      const {result} = await cdp.send('Profiler.takePreciseCoverage', {}, sessionId).catch(() => ({result: []}));
      for (const script of result) {
        const match = new RegExp(`^chrome-extension://${extensionId}/(.+)$`).exec(script.url);
        if (match && script.functions.some(fn => fn.functionName && fn.ranges.some(range => range.count > 0))) used.add(match[1].split('?')[0]);
      }
    }
  };
  return {refresh, stop: async () => { await refresh(); await take(); return used; }};
}

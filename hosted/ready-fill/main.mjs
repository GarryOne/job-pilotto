// The Ready to send container (spec docs/superpowers/specs/2026-10-17-ready-to-send.md), the process the Worker starts: POST /run {site, token} fills the night in the background; the morning's calls then reach the held tabs:
//  GET /state?t=  per job: held or not (410 "gone" when this container holds no night: a fresh one woken after a deploy, or closed);  WS /ws?t=&job=  the live view;  GET /handoff?t=&job=  the hand-off;  POST /close?t=  closes every tab and the browser (the data goes with it: nothing was written to disk but the browser's temp profile).
// Every call needs the night token (the Worker checks the owner first; this is a second lock). No secret is baked in; the token arrives in /run. Guard: desktop/test/ready-fill.test.js, hosted/ready-fill/proof.mjs.
import http from 'node:http';
import {chromium} from 'playwright';
import {WebSocketServer} from 'ws';
import {attach, handoff} from './live.mjs';
import {gone, runNight, why} from './night.mjs';

let night = null, token = '', status = {state: 'idle', jobs: 0, filled: 0};
const log = (what, data = {}) => console.log(JSON.stringify({what, ...data}));   // counts and words only
const json = (response, code, data) => { response.writeHead(code, {'content-type': 'application/json'}); response.end(JSON.stringify(data)); };
const allowed = url => !!token && url.searchParams.get('t') === token;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://x');
  try {
    if (request.method === 'POST' && url.pathname === '/run') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const given = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (night || status.state === 'running') return json(response, 409, {ok: false, error: 'already running'});
      token = String(given.token || ''); status = {state: 'running', jobs: 0, filled: 0};
      runNight({chromium, site: String(given.site || ''), token, log: (what, data) => { log(what, data); if (what === 'job') { status.jobs++; if (['prepared', 'partial'].includes(data.state)) status.filled++; } }})
        .then(done => { night = done; status.state = 'held'; }, error => { status = {...status, state: 'failed', error: why(error)}; log('night failed', {error: status.error}); });
      return json(response, 202, {ok: true});
    }
    if (url.pathname === '/health') return json(response, 200, {ok: true, ...status});
    if (['/state', '/handoff'].includes(url.pathname) && gone(night, status)) return json(response, 410, {ok: false, error: 'gone: this container holds no night'});   // a fresh one woken after a deploy: the runner stops it
    if (!allowed(url)) return json(response, 401, {ok: false, error: 'unauthorized'});
    if (url.pathname === '/state') return json(response, 200, {ok: true, ...status, held: [...(night?.held.keys() || [])]});
    if (url.pathname === '/handoff') { const page = night?.held.get(url.searchParams.get('job')); return page ? json(response, 200, {...await handoff(page), night: night.nights?.get(url.searchParams.get('job')) || {}}) : json(response, 404, {ok: false, error: 'not held'}); }
    if (request.method === 'POST' && url.pathname === '/close') { await night?.close(); night = null; token = ''; status = {state: 'idle', jobs: 0, filled: 0}; return json(response, 200, {ok: true}); }
    json(response, 404, {ok: false});
  } catch (error) { json(response, 500, {ok: false, error: String(error).slice(0, 200)}); }
});
const sockets = new WebSocketServer({noServer: true});
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://x'), page = allowed(url) && night?.held.get(url.searchParams.get('job'));
  if (!page) { socket.destroy(); return; }
  sockets.handleUpgrade(request, socket, head, ws => attach(ws, page).catch(() => ws.close()));
});
server.listen(Number(process.env.PORT) || 8080, () => log('ready-fill listening'));

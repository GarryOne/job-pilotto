// In front of the offline app (lib/offline-app.mjs) for the real extension: pairing is answered here (the extension pairs with this front: the app's own pairing
// needs the person's click), every other call goes to the app with its token; each is recorded. Used by lib/row-replay.mjs and lib/live-row.mjs (a pure move
// out of row-replay.mjs, 11 Oct 2026). -> {port, url, requests, close()}
import http from 'node:http';
import {freePort} from './extension.mjs';

export async function frontOf(app) {
  const port = await freePort(), requests = [], front = {requests, beforeRespond: null};   // beforeRespond(route, body): awaited before an answer goes back (row-replay: a page state that followed an ask)
  const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'};
  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, cors); response.end(); return; }
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', async () => {
      const route = request.url.split('?')[0], body = Buffer.concat(chunks);
      const text = body.toString().slice(0, 20000);
      requests.push({route, at: Date.now(), body: text});
      if (route === '/extension/pair') { response.writeHead(200, {...cors, 'Content-Type': 'application/json'}); response.end(JSON.stringify({url: `http://127.0.0.1:${port}`, token: 'front'})); return; }
      try {
        const upstream = await fetch(`${app.url}${request.url}`, {method: request.method, headers: {'content-type': request.headers['content-type'] || 'application/json',
          authorization: `Bearer ${app.token}`, origin: `chrome-extension://${app.extensionId}`}, ...(['GET', 'HEAD'].includes(request.method) ? {} : {body})});
        const answer = Buffer.from(await upstream.arrayBuffer());
        await Promise.resolve(front.beforeRespond?.(route, text)).catch(() => {});
        response.writeHead(upstream.status, {...cors, 'Content-Type': upstream.headers.get('content-type') || 'application/json'});
        response.end(answer);
      } catch (error) { response.writeHead(502, cors); response.end(JSON.stringify({error: String(error?.message || error)})); }
    });
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return Object.assign(front, {port, url: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(() => resolve()))});
}


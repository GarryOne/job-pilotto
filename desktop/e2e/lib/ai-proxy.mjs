// A pass-through proxy for the engine's AI calls that holds each request for `delayMs` before forwarding it, to reproduce a slow AI deterministically
// (2 Oct 2026: a friend's Jobs check scored 60 jobs for 35 minutes with nothing to show). Real answers, real cost, only slower.
// It can also fail on purpose (setMode): the API answering 429 / 500 / 401, an empty credit balance, or never answering, so the failure states of a run are tested
// without a real outage and without spending anything.
import http from 'node:http';

// What the Anthropic API sends for each failure the app must survive (bodies copied from the real API's error shape).
export const FAILURES = {
  'rate-limit': {status: 429, type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit'},
  'server-error': {status: 500, type: 'api_error', message: 'Internal server error'},
  'invalid-key': {status: 401, type: 'authentication_error', message: 'invalid x-api-key'},
  'no-credit': {status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'},
};
// -> {status, body} for a failure mode, or null for "pass the request through" (and for 'hang', which never answers).
export function failureFor(mode) {
  const failure = FAILURES[mode];
  return failure ? {status: failure.status, body: JSON.stringify({type: 'error', error: {type: failure.type, message: failure.message}})} : null;
}

export async function startAiProxy({delayMs = 0, target = 'https://api.anthropic.com'} = {}) {
  const stats = {calls: 0, delayMs, mode: 'pass'};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    stats.calls++;
    await new Promise(resolve => setTimeout(resolve, stats.delayMs));
    if (stats.mode === 'hang') return;   // never answers; the connection closes with the proxy
    const failure = failureFor(stats.mode);
    if (failure) { res.writeHead(failure.status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(failure.body)}); res.end(failure.body); return; }
    try {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !['host', 'connection', 'content-length', 'accept-encoding'].includes(name)));
      const answer = await fetch(`${target}${req.url}`, {method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)});
      const body = Buffer.from(await answer.arrayBuffer());
      res.writeHead(answer.status, {'content-type': answer.headers.get('content-type') || 'application/json', 'content-length': body.length});
      res.end(body);
    } catch (error) {
      res.writeHead(502, {'content-type': 'application/json'});
      res.end(JSON.stringify({type: 'error', error: {type: 'api_error', message: `proxy: ${error.message}`}}));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, stats, setDelay: ms => { stats.delayMs = ms; },
    // 'pass' (default), 'hang', or a key of FAILURES. Every call after this one is answered that way.
    setMode: mode => { if (mode !== 'pass' && mode !== 'hang' && !FAILURES[mode]) throw new Error(`unknown proxy mode: ${mode}`); stats.mode = mode; }, close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }};
}

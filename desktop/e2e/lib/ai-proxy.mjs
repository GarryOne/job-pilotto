// A pass-through proxy for the engine's AI calls that holds each request for `delayMs` before forwarding it, to reproduce a slow AI deterministically
// (2 Oct 2026: a friend's Jobs check scored 60 jobs for 35 minutes with nothing to show). Real answers, real cost, only slower.
import http from 'node:http';

export async function startAiProxy({delayMs = 0, target = 'https://api.anthropic.com'} = {}) {
  const stats = {calls: 0, delayMs};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    stats.calls++;
    await new Promise(resolve => setTimeout(resolve, stats.delayMs));
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
  return {url: `http://127.0.0.1:${server.address().port}`, stats, setDelay: ms => { stats.delayMs = ms; }, close: () => new Promise(resolve => server.close(resolve))};
}

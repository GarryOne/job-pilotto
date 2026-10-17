// Runs one night in the BUILT container image against a stand-in site (spec docs/superpowers/specs/2026-10-17-ready-to-send.md), so a night that
// cannot start is caught before merge and before a deploy, in about a minute (18 Oct 2026: every real night failed at setup and nothing showed it).
// Usage: node hosted/ready-fill/image-check.mjs <image tag>   (docker must be running; CI: .github/workflows/ready-fill-image.yml, release-ready-runner.yml)
// Fictional data only: one job whose page the stand-in serves itself, no AI, no key, no address outside this machine.
import {execFileSync} from 'node:child_process';
import http from 'node:http';

const image = process.argv[2] || 'ready-fill:local';
const SITE_PORT = 8799, BOX_PORT = 8780, WAIT_MS = 4 * 60 * 1000, name = `ready-check-${process.pid}`;
const seen = [];
const site = http.createServer((request, response) => {
  let body = ''; request.on('data', chunk => body += chunk); request.on('end', () => {
    seen.push({route: request.url.split('?')[0], body: body ? JSON.parse(body) : null});
    if (request.url.startsWith('/job')) { response.writeHead(200, {'content-type': 'text/html'}); return response.end('<h1>SRE at Acme</h1><p>A posting with no form.</p>'); }
    response.writeHead(200, {'content-type': 'application/json'});
    if (request.url.startsWith('/api/ready/batch')) return response.end(JSON.stringify({ok: true, night: '2026-10-18', contact: {name: 'Alex Example', email: 'alex@example.invalid'},
      jobs: [{id: 'j1', url: `http://host.docker.internal:${SITE_PORT}/job`, title: 'SRE', company: 'Acme', fit: 80, kit: {answers: {}}, letter: 'Dear Acme', cv: '', letterPdf: ''}], facts: {}}));
    response.end(JSON.stringify({ok: true}));
  });
});
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8'}).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let failed = '';
await new Promise(resolve => site.listen(SITE_PORT, '0.0.0.0', resolve));
try {
  docker('run', '-d', '--name', name, '--add-host=host.docker.internal:host-gateway', '-p', `${BOX_PORT}:8080`, image);
  let up = false;
  for (const end = Date.now() + 60000; !up && Date.now() < end; await pause(500)) up = await fetch(`http://127.0.0.1:${BOX_PORT}/health`).then(r => r.ok, () => false);
  if (!up) throw new Error('the container did not answer /health within 60 s');
  const run = await fetch(`http://127.0.0.1:${BOX_PORT}/run`, {method: 'POST', body: JSON.stringify({site: `http://host.docker.internal:${SITE_PORT}`, token: 'check'})});
  if (run.status !== 202) throw new Error(`/run answered ${run.status}`);
  let state = {state: 'running'};
  for (const end = Date.now() + WAIT_MS; state.state === 'running' && Date.now() < end; await pause(2000)) state = await (await fetch(`http://127.0.0.1:${BOX_PORT}/state?t=check`)).json();
  const results = seen.filter(s => s.route === '/api/ready/result').map(s => s.body);
  console.log(JSON.stringify({night: state.state, error: state.error || '', jobs: state.jobs, results: results.map(r => `${r.job}:${r.state}`)}));
  if (state.state !== 'held') failed = `the night ended "${state.state}"${state.error ? `: ${state.error}` : ''}`;
  else if (results.length !== 1) failed = `expected 1 result posted, got ${results.length}`;
  else if (results[0].wall === 'error') failed = 'the job threw instead of being tried';
} catch (error) { failed = error.message; }
finally {
  try { console.log(docker('logs', '--tail', '20', name)); } catch { /* no container */ }
  try { docker('rm', '-f', name); } catch { /* already gone */ }
  site.close();
}
if (failed) { console.error(`image check FAILED: ${failed}`); process.exit(1); }
console.log('image check OK: the night read its batch, tried the job and posted its result');

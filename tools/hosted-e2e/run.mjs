// Hosted Always on, end to end with zero setup (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md step 7; owner, 17 Oct 2026: "e2e on the Always on, on managed/hosted Cloudflare, no Notion, 0 setup").
// A fresh install, no Notion, no keys, no GitHub: the app turns Always on on with an e-mail and pushes its profile, the cron tick queues the run, the real engine runs against fixture feeds
// (in the real hosted image with HOSTED_E2E_RUNNER=docker, or a local Python with =python), AI goes through the Worker's /api/ai with the run token to a fake model, the debit is recorded,
// the result lands in the inbox and in the mail, the app pulls it into its own store; then Turn off deletes everything, and a trial that has used its budget pauses with the functional notice.
// Run: node tools/hosted-e2e/run.mjs (CI: .github/workflows/hosted-e2e.yml). Never touches a real account: the Worker, D1, R2, KV, Queue and sender are in-process fakes.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digestOf, tokenFor} from '../../site/src/guard.js';
import {tick} from '../../site/src/hosted-tick.js';
import {run as lifecycle} from '../../site/src/mail-lifecycle.js';
import {pullInbox, schedule, turnOff, turnOn} from '../../desktop/lib/hosted-search.js';
import {TRIAL_KEY} from '../../desktop/lib/ai-free.js';
import {startCloud} from './worker-fakes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HERE = path.join(ROOT, 'tools/hosted-e2e');
const FEEDS = path.join(ROOT, 'desktop/e2e/fixtures/feeds');
const RUNNER = process.env.HOSTED_E2E_RUNNER || 'docker';
const PYTHON = process.env.PYTHON || (fs.existsSync(path.join(ROOT, '.venv/bin/python')) ? path.join(ROOT, '.venv/bin/python') : 'python3');
const log = line => console.log(`hosted-e2e: ${line}`);
const rows = (cloud, text, ...args) => cloud.env.STATS.db.prepare(text).all(...args).map(row => ({...row}));

// Notion and Telegram stand-ins that only count: a hosted run reaching either is a failure.
async function tripwire() {
  const hits = [];
  const server = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.writeHead(500); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {hits, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close()};
}

// Where the engine runs. Both answer like the container's POST /run: {ok}.
function engineEnv(trip) {
  return {JOB_PILOTTO_FIXTURE_DIR: '/fixtures/feeds', JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: trip.url, JOB_PILOTTO_E2E_TELEGRAM_BASE_URL: trip.url};
}
async function containerRunner(trip) {
  const image = 'jp-hosted-e2e';
  if (!process.env.HOSTED_E2E_NO_BUILD) assert.equal(spawnSync('docker', ['build', '-q', '-f', 'hosted/Dockerfile', '-t', image, '.'], {cwd: ROOT, stdio: 'inherit'}).status, 0, 'docker build');
  const env = Object.entries(engineEnv(trip)).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
  const started = spawnSync('docker', ['run', '-d', '--rm', '--network', 'host', '-v', `${FEEDS}:/fixtures/feeds:ro`, ...env, '--name', 'jp-hosted-e2e', image], {encoding: 'utf8'});
  assert.equal(started.status, 0, started.stderr);
  for (let waited = 0; waited < 30; waited++) {   // the image's own start check: GET / answers ok
    try { if ((await fetch('http://127.0.0.1:8080/')).ok) break; } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return {fetch: request => fetch('http://127.0.0.1:8080/run', {method: 'POST', body: request.body, duplex: 'half'}), stop: () => spawnSync('docker', ['logs', 'jp-hosted-e2e'], {stdio: 'inherit'}) && spawnSync('docker', ['stop', 'jp-hosted-e2e'])};
}
function pythonRunner(trip) {
  return {fetch: async request => {
    const {token, site} = await request.json();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hosted-e2e-feeds-'));
    const code = await new Promise(resolve => spawn(PYTHON, ['-m', 'src', 'hosted', '--site', site, '--token', token], {cwd: ROOT, stdio: 'inherit',
      env: {...process.env, ...engineEnv(trip), JOB_PILOTTO_FIXTURE_DIR: FEEDS, JOB_PILOTTO_NO_DOTENV: '1', TMPDIR: folder}}).on('exit', resolve));
    fs.rmSync(folder, {recursive: true, force: true});
    return new Response('{}', {status: code === 0 ? 200 : 500});
  }, stop: () => {}};
}

// The app's side: a Mac with its own sqlite store, no Notion, only the install's Free AI key.
function app(cloud, install) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hosted-e2e-app-'));
  fs.mkdirSync(path.join(home, 'config'));
  fs.copyFileSync(path.join(HERE, 'fixtures/search.json'), path.join(home, 'config/search.json'));
  fs.copyFileSync(path.join(HERE, 'fixtures/profile.md'), path.join(home, 'profile.md'));
  const secrets = new Map(), settings = {};
  const storage = {secret: name => secrets.get(name) || '', setSecret: (name, value) => secrets.set(name, value), settings: () => settings, saveSettings: patch => Object.assign(settings, patch), path: name => path.join(home, name)};
  const fetcher = (url, init) => fetch(String(url).replace('https://www.jobpilotto.top', cloud.site), init);
  const engine = args => new Promise(resolve => { let stdout = ''; const child = spawn(PYTHON, ['-m', ...args], {cwd: ROOT, env: {...process.env, JOB_PILOTTO_STORE: 'sqlite', JOB_PILOTTO_DATA_DIR: path.join(home, 'data'), JOB_PILOTTO_CONFIG_DIR: path.join(home, 'config'), JOB_PILOTTO_NO_DOTENV: '1'}});
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    child.on('exit', code => resolve({code, stdout})); });
  const matches = () => JSON.parse(spawnSync(PYTHON, ['-c', 'import json; from src import store_access; print(json.dumps(store_access.open_run().matches.list(), default=str))'], {cwd: ROOT, encoding: 'utf8',
    env: {...process.env, JOB_PILOTTO_STORE: 'sqlite', JOB_PILOTTO_DATA_DIR: path.join(home, 'data'), JOB_PILOTTO_CONFIG_DIR: path.join(home, 'config'), JOB_PILOTTO_NO_DOTENV: '1'}}).stdout.trim().split('\n').pop());
  const runs = () => JSON.parse(spawnSync(PYTHON, ['-c', 'import json; from src import store_access; print(json.dumps(store_access.open_run().cron_runs.list(), default=str))'], {cwd: ROOT, encoding: 'utf8',
    env: {...process.env, JOB_PILOTTO_STORE: 'sqlite', JOB_PILOTTO_DATA_DIR: path.join(home, 'data'), JOB_PILOTTO_CONFIG_DIR: path.join(home, 'config'), JOB_PILOTTO_NO_DOTENV: '1'}}).stdout.trim().split('\n').pop());
  return (async () => {
    secrets.set(TRIAL_KEY, `JPF1.${install}.${await tokenFor(install, {STATS_SALT: cloud.env.STATS_SALT}, 'ai')}`);
    return {storage, options: {fetcher}, engine, matches, runs, home};
  })();
}
const due = (cloud, account) => cloud.env.STATS.db.prepare("UPDATE hosted_schedules SET next_run_at = '2000-01-01T00:00:00.000Z' WHERE account = ?").run(account);

async function main() {
  const trip = await tripwire();
  const cloud = await startCloud({});
  const engine = RUNNER === 'docker' ? await containerRunner(trip) : pythonRunner(trip);
  cloud.setRunner(engine);
  try {
    // 1. A fresh install turns Always on on (the wizard's default) with an address; its profile is pushed.
    const mac = await app(cloud, 'e2e-install-0001');
    assert.equal((await schedule(mac.storage, mac.options)), null, 'a fresh install has no schedule yet');
    const on = await turnOn(mac.storage, {email: 'Alex@Example.com', marketing: true}, mac.options);
    assert.deepEqual(on, {ok: true});
    const account = rows(cloud, 'SELECT id, plan, email FROM pro_accounts')[0];
    assert.deepEqual([account.plan, account.email], ['trial', 'alex@example.com']);
    const config = [...cloud.env.HOSTED_STATE.map.entries()].find(([key]) => key.endsWith('/config.json'));
    assert.ok(config, 'the profile and search are held');
    assert.ok(!Buffer.from(config[1]).includes('Zurich'), 'held encrypted: no readable profile text in the bucket');
    log('1 turned on, profile held encrypted');

    // 2. What an earlier run would have left (two fixture employers), then the cron tick finds the run due.
    const seed = path.join(os.tmpdir(), `jp-hosted-seed-${process.pid}.tgz`);
    assert.equal(spawnSync(PYTHON, [path.join(HERE, 'seed_state.py'), seed], {cwd: ROOT, stdio: 'inherit'}).status, 0);
    await cloud.holdState(account.id, fs.readFileSync(seed));
    due(cloud, account.id);
    const ticked = await tick(cloud.env, new Date());
    assert.equal(ticked.enqueued, 1, `the tick queues one run: ${JSON.stringify(ticked)}`);
    const queued = await cloud.drain();
    assert.deepEqual(queued, {ok: 1, failed: 0}, 'the container ran');
    log('2 tick queued the run, the engine ran');

    // 3. The result: stored, the debit, the mail, the fake model's calls.
    const run = rows(cloud, 'SELECT status, compute_micro FROM hosted_runs')[0];
    assert.equal(run.status, 'ok');
    assert.equal(run.compute_micro, 11000, 'the flat compute debit of one run');
    const inbox = rows(cloud, 'SELECT job, payload FROM hosted_inbox');
    assert.ok(inbox.length >= 1, 'new matches reached the inbox');
    assert.ok(cloud.ai.calls.length >= 1 && cloud.ai.calls.every(call => call.model), `the engine asked the fake model through /api/ai: ${cloud.ai.calls.length} calls`);
    const spent = Number(await cloud.env.WAITLIST.get(`freeai:life:${await digestOf('e2e-install-0001')}`));
    assert.ok(spent >= 11000 && spent < 2e6, `the trial budget was debited: ${spent} micro-USD of 2,000,000`);
    assert.equal(cloud.sent.length, 1, 'one digest e-mail');
    const mail = cloud.sent[0];
    assert.equal(mail.to, 'alex@example.com');
    assert.ok(!/pro launch|product news|offer|upgrade|\bpro\b/i.test(`${mail.subject} ${mail.text}`), `functional only, no marketing line:\n${mail.text}`);
    assert.match(mail.text, /unsubscribe|stop/i);
    log(`3 inbox ${inbox.length}, debit ${spent}, mail "${mail.subject}", ${cloud.ai.calls.length} fake-model calls`);

    // 4. The app pulls the matches into its own store (the Jobs list) with no Notion anywhere.
    const pulled = await pullInbox(mac.storage, mac.engine, mac.options);
    assert.ok(pulled.ok && pulled.added >= 1, `the app added the matches: ${JSON.stringify(pulled)}`);
    const titles = mac.matches().map(match => match.title);
    assert.ok(titles.some(title => /reliability|platform/i.test(title)), `Jobs shows them: ${titles.join(' | ')}`);
    assert.deepEqual(mac.runs().map(run => [run.where, run.summary]), [['cloud', `${pulled.added} new ${pulled.added === 1 ? 'job' : 'jobs'} while you were away`]], 'Recent activity has the run card');
    assert.deepEqual(trip.hits, [], 'nothing reached Notion or Telegram');
    log(`4 the app pulled ${pulled.added} into its own store`);

    // 5. Turn off deletes everything we hold.
    const off = await turnOff(mac.storage, mac.options);
    assert.ok(off.ok && off.receipt.objects >= 1, JSON.stringify(off));
    assert.equal([...cloud.env.HOSTED_STATE.map.keys()].filter(key => key.includes(account.id)).length, 0, 'R2 is empty');
    for (const table of ['hosted_schedules', 'hosted_runs', 'hosted_inbox']) assert.equal(rows(cloud, `SELECT * FROM ${table} WHERE account = ?`, account.id).length, 0, `${table} is empty`);
    log('5 turned off: R2, schedule, runs and inbox deleted');

    // 6. A trial that has used its budget pauses, and the functional notice goes out (no sales line while marketing is off).
    const second = await app(cloud, 'e2e-install-0002');
    await turnOn(second.storage, {email: 'sam@example.com', marketing: false}, second.options);
    const sam = rows(cloud, "SELECT id FROM pro_accounts WHERE email = 'sam@example.com'")[0];
    await cloud.env.WAITLIST.put(`freeai:life:${await digestOf('e2e-install-0002')}`, String(2e6 + 1));
    due(cloud, sam.id);
    const paused = await tick(cloud.env, new Date());
    assert.deepEqual([paused.enqueued, paused.paused], [0, {'trial-over': 1}]);
    assert.equal((await schedule(second.storage, second.options)).pause_reason, 'trial-over');
    const before = cloud.sent.length;
    await lifecycle(cloud.env, new Date());
    const notice = cloud.sent.slice(before).find(message => message.to === 'sam@example.com');
    assert.ok(notice, 'the pause notice was sent');
    assert.ok(!/pro launch|offer|upgrade|get pro/i.test(`${notice.subject} ${notice.text}`), `no sales line:\n${notice.text}`);
    assert.deepEqual(trip.hits, [], 'still nothing reached Notion or Telegram');
    log(`6 trial-over paused, notice "${notice.subject}"`);

    // 7. 14 days without the app: the schedule pauses, the notice says to open the app, and opening it resumes (the card's Resume does the same).
    const third = await app(cloud, 'e2e-install-0003');
    await turnOn(third.storage, {email: 'kim@example.com', marketing: false}, third.options);
    const kim = rows(cloud, "SELECT id FROM pro_accounts WHERE email = 'kim@example.com'")[0];
    cloud.env.STATS.db.prepare("UPDATE hosted_schedules SET last_seen_at = ? WHERE account = ?").run(new Date(Date.now() - 15 * 864e5).toISOString(), kim.id);
    due(cloud, kim.id);
    assert.deepEqual((await tick(cloud.env, new Date())).paused, {inactive: 1});
    const sentBefore = cloud.sent.length;
    await lifecycle(cloud.env, new Date());
    const idle = cloud.sent.slice(sentBefore).find(message => message.to === 'kim@example.com');
    assert.match(`${idle?.subject} ${idle?.text}`, /open the app to resume/i);
    assert.equal((await schedule(third.storage, third.options)).state, 'paused');
    await pullInbox(third.storage, third.engine, third.options);   // the app opens: its start-up inbox pull
    assert.equal((await schedule(third.storage, third.options)).state, 'on', 'opening the app (the inbox pull) resumed it');
    log('7 inactive pause: notice sent, opening the app resumed');
    log('PASS');
  } finally {
    engine.stop();
    await cloud.close();
    trip.close();
  }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

// npm run twin (in desktop/): a live-test twin of the owner's app (owner, 8 Oct 2026): the real app's state 1:1, real websites, its OWN window and
// browser, and a one-way Notion mirror instead of the real workspace. Never the owner's app window, Chrome windows, Telegram or real Notion; never Submit.
//   1. syncs real Notion -> "Job Pilotto – Live Test" (tools/notion_copy.py, read-only on the source; --no-sync skips it)
//   2. asserts the mirror's token cannot open the real workspace (404), else stops
//   3. a fresh copy of the real app folder (APFS clone) without the real Notion token, Always on or Telegram, pointed at the mirror
//   4. the app in twin mode (desktop/lib/twin.js) on its own port + a debugging port; its own visible Chromium with an extension copy on that port
// Everything live-test lives in ~/Library/Application Support/Job Pilotto (live test)/: ids.env (the mirror's ids), notion-copy/ (sync map),
// home/ (the twin's folder, replaced at each start), browser/ (its Chromium profile, kept: site sign-ins), twin.json (ports, for a script that drives the window). Ctrl-C stops both.
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {copyExtension, freePort, launchBrowser, makeOpenShim} from './lib/extension.mjs';
import {realFolder} from '../lib/twin.js';

const DESKTOP = path.resolve(import.meta.dirname, '..'), REPO = path.resolve(DESKTOP, '..');
const REAL = realFolder(), LIVE = path.join(path.dirname(REAL), 'Job Pilotto (live test)'), HOME = path.join(LIVE, 'home');
const SOURCE_TOKEN = 'job-pilotto.notion.token-desktop-real', MIRROR_TOKEN = 'job-pilotto.notion.token-live-test';
const keychain = service => execFileSync('security', ['find-generic-password', '-s', service, '-w'], {encoding: 'utf8'}).trim();
const say = text => console.log(`twin: ${text}`);
const idsOf = file => Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').map(line => line.trim().split('=')).filter(([key, value]) => key?.startsWith('NOTION_') && value));

export async function notionStatus(token, id) {
  const response = await fetch(`https://api.notion.com/v1/databases/${id}`, {headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28'}});
  return response.status;
}

async function main() {
  if (!fs.existsSync(path.join(LIVE, 'ids.env'))) throw new Error(`no ${path.join(LIVE, 'ids.env')}: create the mirror first (tools/notion_copy.py create, docs/live-test.md)`);
  const mirror = idsOf(path.join(LIVE, 'ids.env')), real = JSON.parse(fs.readFileSync(path.join(REAL, 'settings.json'), 'utf8')).notionIds || {};
  const token = keychain(MIRROR_TOKEN);
  // 2. The mirror's token must not reach the real workspace: every real database answers 404 to it.
  for (const [key, id] of Object.entries(real).filter(([key]) => key.endsWith('_DB'))) {
    const status = await notionStatus(token, id);
    if (status !== 404) throw new Error(`the Live Test token can open the real ${key} (HTTP ${status}): fix its Notion access before running a twin`);
  }
  say(`isolated: the Live Test token gets 404 on all ${Object.keys(real).filter(key => key.endsWith('_DB')).length} real databases`);
  // 1. One-way sync, real -> mirror.
  if (!process.argv.includes('--no-sync')) {
    say('syncing real Notion -> Live Test (read-only on the real side)…');
    execFileSync('python3', [path.join(REPO, 'tools', 'notion_copy.py'), 'copy', '--from', SOURCE_TOKEN, '--from-ids', path.join(REAL, 'settings.json'),
      '--to', MIRROR_TOKEN, '--to-ids', path.join(LIVE, 'ids.env'), '--state', path.join(LIVE, 'notion-copy')], {stdio: ['ignore', 'ignore', 'inherit'], cwd: REPO});
  }
  // 3. A fresh copy of the real folder, then what must not come along.
  fs.rmSync(HOME, {recursive: true, force: true});
  execFileSync('cp', ['-c', '-R', REAL, HOME]);   // an APFS clone: instant, no extra space
  for (const name of fs.readdirSync(HOME).filter(name => name.startsWith('Singleton'))) fs.rmSync(path.join(HOME, name), {force: true});
  fs.rmSync(path.join(HOME, 'logs'), {recursive: true, force: true});
  const secrets = JSON.parse(fs.readFileSync(path.join(HOME, 'secrets.json'), 'utf8'));
  delete secrets.NOTION_TOKEN; delete secrets.EXTENSION_TOKEN; delete secrets.TELEGRAM_BOT_TOKEN; delete secrets.GITHUB_TOKEN;
  fs.writeFileSync(path.join(HOME, 'secrets.json'), JSON.stringify(secrets, null, 2));
  const settings = JSON.parse(fs.readFileSync(path.join(HOME, 'settings.json'), 'utf8'));
  delete settings.cloud; delete settings.telegramChatId; delete settings.telegramCloud;
  settings.notionIds = mirror;
  if (settings.employersSyncedTo) settings.employersSyncedTo = mirror.NOTION_EMPLOYERS_DB;
  fs.writeFileSync(path.join(HOME, 'settings.json'), JSON.stringify(settings, null, 2));
  say(`folder: a fresh copy of the real one at ${HOME} (no real Notion token, Always on or Telegram)`);
  // 4. The app and its own browser.
  const port = await freePort(), cdp = await freePort(), browserCdp = await freePort(), shim = makeOpenShim(), extensionDir = copyExtension(port);
  // The owner's Chrome has the extension's "all sites" access granted (optional_host_permissions, one click there); the twin's copy has it
  // built in, so it reads any employer site as the owner's does (8 Oct 2026: on jobs.coop.ch the twin's extension saw no tab at all).
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || [])])];
  fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('JOB_PILOTTO_')));
  const app = spawn(path.join(DESKTOP, 'node_modules', '.bin', 'electron'), [DESKTOP, `--remote-debugging-port=${cdp}`], {cwd: DESKTOP, stdio: ['ignore', 'inherit', 'inherit'],
    env: {...env, JOB_PILOTTO_TWIN: '1', JOB_PILOTTO_USER_DATA: HOME, JOB_PILOTTO_TWIN_NOTION_TOKEN: token, JOB_PILOTTO_PORT: String(port),
      PATH: `${shim.bin}${path.delimiter}${process.env.PATH}`, JOB_PILOTTO_E2E_OPEN_DIR: shim.spool}});
  const browser = await launchBrowser({port, spool: shim.spool, extensionDir, real: true, profile: path.join(LIVE, 'browser'), debugPort: browserCdp});   // kept: site sign-ins survive
  fs.writeFileSync(path.join(LIVE, 'twin.json'), JSON.stringify({cdp: `http://127.0.0.1:${cdp}`, browser: `http://127.0.0.1:${browserCdp}`, port, app: app.pid, home: HOME, at: new Date().toISOString()}, null, 1));
  say(`running: app on port ${port}, window driver at http://127.0.0.1:${cdp} (${path.join(LIVE, 'twin.json')}); its browser is the separate Chromium window. Ctrl-C stops both.`);
  // Stopping always stops the app first (8 Oct 2026: a stop that awaited the browser first left the twin's app running on its ports),
  // and an exit by any path kills it as a last resort.
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    app.kill();
    fs.rmSync(path.join(LIVE, 'twin.json'), {force: true});
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
  process.on('exit', () => { try { app.kill(); } catch { /* already gone */ } });
  app.on('exit', code => { say(`app exited (${code})`); stop(); });
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(`twin: ${error.message}`); process.exit(1); });

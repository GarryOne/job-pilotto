/* global document, window */
// The real Chrome extension (a copy with the test port) in a real Chromium, for the apply suite. Chromium loads the extension folder as it is (extension/), the fixture forms answer to the
// job-site host names the extension is allowed on (lib/forms.mjs), and the app's own "Apply" click reaches this browser through a stand-in `open` command
// on the app's PATH (the app runs `open -a "Google Chrome" <url>`: here that URL is handed to this Chromium instead).
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {E2E} from './app.mjs';
import {hostRules} from './forms.mjs';

export const EXTENSION_DIR = path.resolve(E2E, '..', '..', 'extension');
export const DEFAULT_APP_PORT = 47111;   // the extension's built-in address for the app (extension/flow.js APP)

// A port nothing listens on. The test app and its extension use it, so the suite runs next to the user's own Job Pilotto, which keeps 47111: the extension
// under test can never pair with a live app.
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { const {port: got} = server.address(); server.close(() => resolve(got)); });
    });
    if (port !== DEFAULT_APP_PORT) return port;
  }
}

// A copy of the extension folder whose built-in app address is `port` (extension/ itself is never edited). Throws when the address is not found in the
// source: a rewrite that silently did nothing would leave the extension talking to the live app on 47111.
export function copyExtension(port, from = EXTENSION_DIR) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-ext-')), 'extension');
  fs.cpSync(from, dir, {recursive: true});
  const flow = path.join(dir, 'flow.js');
  const source = fs.readFileSync(flow, 'utf8');
  const address = `http://127.0.0.1:${DEFAULT_APP_PORT}`;
  if (!source.includes(address)) throw new Error(`extension/flow.js no longer contains ${address}: update copyExtension() (the test extension must not talk to port ${DEFAULT_APP_PORT})`);
  fs.writeFileSync(flow, source.replaceAll(address, `http://127.0.0.1:${port}`));
  const left = fs.readdirSync(dir).filter(file => file.endsWith('.js') && fs.readFileSync(path.join(dir, file), 'utf8').includes(`127.0.0.1:${DEFAULT_APP_PORT}`));
  if (left.length) throw new Error(`the test extension still mentions 127.0.0.1:${DEFAULT_APP_PORT} in ${left.join(', ')}`);
  return dir;
}

// A folder with an `open` that writes the URL it was given into a spool folder (the app finds it first on PATH). -> {bin, spool}
export function makeOpenShim() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-open-'));
  const bin = path.join(root, 'bin'), spool = path.join(root, 'spool');
  fs.mkdirSync(bin); fs.mkdirSync(spool);
  fs.writeFileSync(path.join(bin, 'open'), '#!/bin/sh\nfor last; do :; done\nf=$(mktemp "$JOB_PILOTTO_E2E_OPEN_DIR/open.XXXXXX") && printf \'%s\' "$last" > "$f" && mv "$f" "$f.url"\n', {mode: 0o755});
  return {bin, spool};
}

// -> {context, opened: [url], serviceWorker(), page(url), close()}. Every URL the app opens is opened here, in a new tab.
export async function launchBrowser({port, spool, extensionDir}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-chromium-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false, ignoreHTTPSErrors: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [...(process.env.E2E_HEADED ? [] : ['--headless=new']), `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`,
      `--host-resolver-rules=${hostRules(port)}`, '--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check'],
  });
  const opened = [], pages = {}, requested = new Set();   // requested: every host name the browser asked for (a test proves no employer site was contacted)
  context.on('request', request => { try { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol)) requested.add(url.hostname); } catch { /* not a URL */ } });
  let stopped = false;
  const watcher = (async () => {
    while (!stopped) {
      for (const file of fs.readdirSync(spool).filter(name => name.endsWith('.url'))) {
        const url = fs.readFileSync(path.join(spool, file), 'utf8').trim();
        fs.rmSync(path.join(spool, file));
        if (!/^https:\/\//.test(url)) continue;   // the app asked `open` for something else: nothing to do here
        const tab = await context.newPage();
        pages[url.split('#')[0]] = tab;
        opened.push(url);   // after the tab exists: a caller that sees the URL finds its tab
        tab.goto(url).catch(() => {});
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  })();
  const serviceWorker = async () => context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
  return {context, opened, pages, requested, serviceWorker,
    close: async () => { stopped = true; await watcher.catch(() => {}); await context.close().catch(() => {}); }};
}

// The form as the page holds it now: field id (or name) -> {type, value, checked, files: [{name, size}], ai}. `ai` is the extension's own marker on an
// answer the AI wrote. Hidden fields are included (a step the person has not reached must not be filled).
export const readForm = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('input, select, textarea')]
  .filter(el => el.type !== 'submit' && el.type !== 'button')
  .map(el => [el.id || el.name, {type: el.type, value: el.type === 'file' ? '' : el.value, checked: !!el.checked, hidden: el.getClientRects().length === 0,
    files: [...(el.files || [])].map(file => ({name: file.name, size: file.size})), ai: el.hasAttribute('data-jobpilotto-ai')}])));

// What the page says the extension is doing: the state the extension writes for Claude on <html data-jobpilotto-fill> ({state: running|done|error|no-form|account, ...}).
export const fillState = page => page.evaluate(() => { try { return JSON.parse(document.documentElement.dataset.jobpilottoFill || 'null'); } catch { return null; } });

// The panel the extension draws on the page (bottom right, an open shadow root).
export const readPanel = page => page.evaluate(() => {
  const root = document.getElementById('jobpilotto-review-host')?.shadowRoot;
  if (!root) return null;
  const text = selector => (root.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
  return {pill: text('.pill'), progress: text('.progress-line'), note: root.querySelector('.note')?.hidden ? '' : text('.note'),
    left: [...root.querySelectorAll('.left .item')].map(item => item.textContent.replace(/\s+/g, ' ').trim()), foot: text('.foot'), fillLabel: text('.fill .label')};
});

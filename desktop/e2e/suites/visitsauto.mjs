/* global chrome */
// "Find jobs using your browser" from the Actions card (7 Oct 2026): the REAL extension (a copy that talks to a stand-in app on a free port) in a real
// Chromium, on fixture job lists served over HTTPS. A page the app did not mark is left alone; a marked tab without the one-time permission waits
// (and is read nowhere); a marked tab on a site the extension may read is read by itself, page after page, reported to the app and closed.
// Simulated: Chrome's one-time "all sites" grant cannot be given from a script, so for the read step the extension's check of it is stubbed in its
// worker; the reading itself runs on a job-system host the extension is already allowed on. No Notion, no AI, no real site.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {browserChannel, copyExtension, freePort} from '../lib/extension.mjs';

export const name = 'visitsauto';
export const minutes = 4;
export const light = true;
export const needsChromium = true;   // CI installs Chromium for it (.github/workflows/e2e.yml)
export const keepGoing = true;

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'visits');
const ALLOWED = 'jobs.lever.co';         // a job-system host in the extension's host_permissions
const OTHER = 'careers.example.ch';      // any other careers site: needs the one-time grant
const wait = ms => new Promise(done => setTimeout(done, ms));
async function until(check, ms = 15000) { for (let waited = 0; waited < ms; waited += 250) { if (await check()) return true; await wait(250); } return false; }

// The app's side of the extension's calls: pairing, no recipe, no filters, each page read (its cards counted), and the done report.
function standInApp(port) {
  const calls = [];
  const jobs = new Map();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const payload = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
      if (req.method === 'POST') calls.push({path: req.url, payload});   // a CORS preflight (OPTIONS) is not a call
      const reply = data => { res.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}); res.end(JSON.stringify(data)); };
      if (req.method === 'OPTIONS') { reply({}); return; }
      if (req.url === '/extension/pair') { reply({url: `http://127.0.0.1:${port}`, token: 'e2e-token'}); return; }
      if (req.url === '/extension/visit-read') {
        const seen = jobs.get(payload.session) || new Set();
        const before = seen.size;
        for (const card of payload.cards || []) seen.add(card.url);
        jobs.set(payload.session, seen);
        reply({ok: true, name: 'Fixture portal', jobs: seen.size, added: seen.size - before, kind: 'portal'});
        return;
      }
      if (req.url === '/extension/visit-recipe' || req.url === '/extension/visit-understand') { reply({ok: true, recipe: null}); return; }
      if (req.url === '/extension/visit-filters') { reply({ok: true, steps: [], why: ''}); return; }
      if (req.url === '/extension/visit-list') { reply({ok: true, hosts: []}); return; }
      reply({ok: true});
    });
  });
  return {calls, server};
}

export async function run(ctx) {
  const certs = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-visits-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=jp-e2e', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem')], {stdio: 'ignore'});
  const sites = https.createServer({key: fs.readFileSync(path.join(certs, 'key.pem')), cert: fs.readFileSync(path.join(certs, 'cert.pem'))}, (req, res) => {
    const file = path.join(FIXTURES, path.basename(new URL(req.url, 'https://x').pathname));
    if (!fs.existsSync(file) || !file.endsWith('.html')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(fs.readFileSync(file));
  });
  await new Promise(done => sites.listen(0, '127.0.0.1', done));
  const appPort = await freePort();
  const app = standInApp(appPort);
  await new Promise(done => app.server.listen(appPort, '127.0.0.1', done));
  const extensionDir = copyExtension(appPort);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-visits-chromium-'));
  const rules = [`MAP ${ALLOWED} 127.0.0.1:${sites.address().port}`, `MAP ${OTHER} 127.0.0.1:${sites.address().port}`, 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'].join(', ');
  const context = await chromium.launchPersistentContext(profile, {
    ...browserChannel(), headless: false, ignoreHTTPSErrors: true, ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'],
    args: [...(process.env.E2E_HEADED ? [] : ['--headless=new']), `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`,
      `--host-resolver-rules=${rules}`, '--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check'],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
  const reads = () => app.calls.filter(call => call.path === '/extension/visit-read');
  try {
    await ctx.run('the extension starts and reaches the stand-in app, never the user\'s own (a different port)', async () => {
      if (!worker) throw new Error('the extension\'s worker did not start');
      if (appPort === 47111) throw new Error('the test app must not use the live app\'s port');
    });

    await ctx.run('a page the app did not mark is left alone: nothing read, nothing sent', async () => {
      const tab = await context.newPage();
      await tab.goto(`https://${ALLOWED}/list-1.html`);
      await wait(3000);
      if (reads().length) throw new Error(`${reads().length} pages were read without the app's mark`);
      await tab.close();
    });

    await ctx.run('a marked tab waiting on the person says so: the Allow page opens beside it and the app is told it waits (owner\'s rule), nothing is read', async () => {
      const tab = await context.newPage();
      await tab.goto(`https://${OTHER}/list-1.html#jp-read`);
      const waiting = await until(async () => Object.keys(await worker.evaluate(() => chrome.storage.session.get(null))).some(key => key.startsWith('waiting:')), 10000);
      if (!waiting) throw new Error('the tab is not waiting for the permission');
      const allowPage = await until(() => context.pages().some(page => /\/allow\.html$/.test(page.url())), 10000);
      if (!allowPage) throw new Error('no Allow page opened: the person would not know they must act');
      const told = await until(() => app.calls.some(call => call.path === '/extension/visit-waiting' && call.payload.url === `https://${OTHER}/list-1.html`), 10000);
      if (!told) throw new Error('the app was not told the site waits on the person');
      if (reads().length) throw new Error('a page was read before the person allowed it');
      for (const page of context.pages().filter(page => /\/allow\.html$/.test(page.url()))) await page.close();
      await tab.close();
      await worker.evaluate(async () => { const all = await chrome.storage.session.get(null); await chrome.storage.session.remove(Object.keys(all).filter(key => key.startsWith('waiting:'))); });
    });

    await ctx.run('a marked tab, once allowed, is read by itself over its pages, reported to the app as done, and closed', async () => {
      await worker.evaluate(() => { chrome.permissions.contains = async () => true; });   // the one-time grant, simulated (see the top of this file)
      const tab = await context.newPage();
      const closed = new Promise(resolve => tab.once('close', resolve));
      await tab.goto(`https://${ALLOWED}/list-1.html#jp-read`);
      const reported = await until(() => app.calls.some(call => call.path === '/extension/visit-done'), 60000);
      if (!reported) throw new Error(`no done report; calls: ${app.calls.map(call => call.path).join(', ')}`);
      const report = app.calls.find(call => call.path === '/extension/visit-done').payload;
      console.log(`    done: ${JSON.stringify({url: report.url, pages: report.pages, jobs: report.jobs, stopped: report.stopped})}`);
      if (report.url !== `https://${ALLOWED}/list-1.html`) throw new Error(`reported for ${report.url}, without the mark expected`);
      if (report.pages !== 2 || report.jobs !== 3) throw new Error(`read ${report.pages} pages and ${report.jobs} jobs, expected 2 and 3`);
      const gone = await Promise.race([closed.then(() => true), wait(10000).then(() => false)]);
      if (!gone) throw new Error('the tab stayed open: the app could not open the next site in its place');
    });

    await ctx.run('a marked tab whose site redirects by script and drops the mark is still read by itself', async () => {
      app.calls.length = 0;
      const tab = await context.newPage();
      await tab.goto(`https://${ALLOWED}/redirect.html#jp-read-c0ffee12`);
      const reported = await until(() => app.calls.some(call => call.path === '/extension/visit-done'), 60000);
      if (!reported) throw new Error(`no done report after the redirect; the tab is at ${tab.isClosed() ? '(closed)' : tab.url()}; calls: ${app.calls.map(call => call.path).join(', ')}`);
      const report = app.calls.find(call => call.path === '/extension/visit-done').payload;
      console.log(`    done: ${JSON.stringify({url: report.url, ticket: report.ticket, pages: report.pages, jobs: report.jobs})}`);
      if (report.ticket !== 'c0ffee12') throw new Error(`reported with ticket ${report.ticket}: the app could not match it to the run`);
      if (report.jobs !== 3) throw new Error(`read ${report.jobs} jobs, expected 3`);
    });
  } finally {
    await context.close().catch(() => {});
    app.server.close();
    sites.close();
  }
}

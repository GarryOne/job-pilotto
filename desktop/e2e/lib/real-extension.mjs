/* global document, location, chrome */
// The REAL extension in a real (headless) Chromium on a REAL site, isolated from everything of the owner's: the way to validate a form fix before
// saying it works (CLAUDE.md "Validate a form fix on the real extension"). What it cuts off, and proves it did:
//  - the owner's live app: the extension is a copy whose built-in app address (127.0.0.1:47111) is a port nothing but a stand-in answers on
//    (lib/extension.mjs copyExtension), and `assertIsolated()` fails the run if the extension's storage points anywhere else;
//  - the owner's profile, CV, Keychain, Notion and AI: the stand-in app serves fake applicant details and the fixture CV, and answers every
//    other call with {} (no AI, no Notion);
//  - the owner's browser: a temporary profile of Playwright's own Chromium.
// What it cannot imitate: the app's AI (page kind, answers), so the panel's "Fill anyway" is used when the rule calls a page an account page.
// A real third-party site gets only this fake data. Some pages send a chosen file at once (SuccessFactors uploads on choice): only the fixture goes.
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {E2E} from './app.mjs';
import {EXTENSION_DIR, browserChannel, copyExtension, freePort} from './extension.mjs';

export const FIXTURE_CV = path.join(E2E, 'fixtures', 'cv.pdf');
const pdf = (name, source = FIXTURE_CV) => ({data: fs.readFileSync(source).toString('base64'), name, type: 'application/pdf'});
export const FAKE_CONTACT = {first_name: 'Test', last_name: 'Candidate', email: 'test.candidate@example.com'};

// options: {extensionDir (default: this checkout's extension/), cv: true|false (the CV the app has), letter: true|false (an approved cover letter file),
// contact (fake details)}. -> {context, page, port, requests, assertIsolated, panel, fillWithPanel, told, controlReports, close}
export async function startRealExtension({extensionDir = EXTENSION_DIR, cv = true, letter = false, contact = FAKE_CONTACT} = {}) {
  const port = await freePort();
  const copy = copyExtension(port, extensionDir);
  const requests = [];
  const answers = {'/extension/pair': () => ({url: `http://127.0.0.1:${port}`, token: 'e2e'}),
    '/extension/me': () => ({contact, contactSource: 'e2e', ...(cv ? {resume: pdf('cv.pdf')} : {}), ...(letter ? {coverLetterFile: pdf('letter.pdf')} : {})})};
  const stub = http.createServer((request, response) => {
    const headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json'};
    if (request.method === 'OPTIONS') { response.writeHead(204, headers); response.end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const route = request.url.split('?')[0];
      requests.push({route, body: body.slice(0, 20000)});
      response.writeHead(200, headers);
      response.end(JSON.stringify(answers[route] ? answers[route]() : {}));
    });
  });
  await new Promise(resolve => stub.listen(port, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-real-ext-'));
  const context = await chromium.launchPersistentContext(profile, {
    ...browserChannel(), headless: false, locale: 'en-US', ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'],
    args: [...(process.env.E2E_HEADED ? [] : ['--headless=new']), `--disable-extensions-except=${copy}`, `--load-extension=${copy}`, '--no-first-run', '--no-default-browser-check'],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
  await worker.evaluate(async url => chrome.storage.local.set({workerUrl: url, token: 'e2e'}), `http://127.0.0.1:${port}`);
  const close = async () => { await context.close().catch(() => {}); stub.close(); };

  // Fails the run unless the extension talks to the stand-in only.
  const assertIsolated = async () => {
    const stored = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    if (!stored.includes(`"workerUrl":"http://127.0.0.1:${port}"`) || stored.includes('47111')) throw new Error(`NOT ISOLATED: the extension is not on the stand-in app's port ${port}`);
    return true;
  };
  await assertIsolated().catch(async error => { await close(); throw error; });

  const page = await context.newPage();
  const panel = () => page.evaluate(() => {
    const root = document.getElementById('jobpilotto-review-host')?.shadowRoot;
    const text = selector => (root?.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
    return {buttons: [...(root?.querySelectorAll('button') || [])].map(button => (button.textContent || '').trim()).filter(Boolean), pill: text('.pill'), progress: text('.progress-line'), note: text('.note')};
  });
  // What the app does for "Apply" (the same tab, marked for the extension), then the person's own click on the panel's Fill button.
  const fillWithPanel = async () => {
    await page.evaluate(() => { location.hash = 'jobpilotto-fill'; });
    await page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('button'), null, {timeout: 20000});
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const buttons = [...(document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelectorAll('button') || [])].filter(button => !button.disabled);
      const pick = buttons.find(button => /^fill anyway$/i.test((button.textContent || '').trim())) || buttons.find(button => /^(fill this form|fill again)$/i.test((button.textContent || '').trim()));
      if (pick) pick.click();
      return pick ? pick.textContent.trim() : null;
    });
  };
  // Everything the extension sent the stand-in app whose body contains `text` (a field label, a reason): how a test proves a report left the extension.
  const told = text => requests.some(request => request.body.includes(text));
  const controlReports = () => requests.filter(request => request.route === '/extension/controls').map(request => { try { return JSON.parse(request.body); } catch { return null; } }).filter(Boolean);
  return {context, page, port, requests, assertIsolated, panel, fillWithPanel, told, controlReports, close};
}

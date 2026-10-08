/* global document, window */
// npm run twin:drive -- <command> (in desktop/): drive and read a running live-test twin (e2e/twin.mjs) the way the owner would, visibly:
// every click and keystroke is outlined in orange with a "Claude: …" caption first, so the owner watching the twin sees what is pressed and why.
// Reads never return a password field's value; clicks refuse a control that looks like a form's Submit (except inside our own panel).
// Only the twin's own ports (twin.json) are reached: never the owner's app or Chrome. Docs: docs/live-test.md. Guarded by test/twin-drive.test.js.
//   inspect <session>              the app's view (left, pending, proposals) + the page's own state for each pending field
//   reopen <session>               the card's "Open in Chrome" path: the tab, else the form reopened with the fill mark
//   click <tab> <selector> [why]   a real click in the twin's browser (tab: part of its address)
//   type <row title> <text>        types into a Needs your attention row of the app and presses Enter
//   app "<js>" | page <tab> "<js>" evaluates in the app window | in a tab, prints the JSON result
//   shot app|<tab> <file.png>      a screenshot of the app window or a tab
//   arrange                        both twin windows to the front, the browser on the right half
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {looksLikeSubmit} from './lib/twin-guards.mjs';

export const TWIN_JSON = path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto (live test)', 'twin.json');

const twin = () => {
  try { return JSON.parse(fs.readFileSync(TWIN_JSON, 'utf8')); } catch { throw new Error('no twin running (start one: cd desktop && npm run twin)'); }
};
async function connect(which) {
  const browser = await chromium.connectOverCDP(twin()[which]);
  return {browser, pages: browser.contexts().flatMap(context => context.pages()), close: () => browser.close().catch(() => {})};
}
const appWindow = pages => pages.find(page => !page.url().startsWith('devtools'));
const tabOf = (pages, part) => pages.find(page => page.url().includes(part)) || null;

// The outline + caption, then a pause: the owner sees the target before anything happens.
export async function show(locator, caption, ms = 1200) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.evaluate((el, caption) => {
    document.getElementById('claude-caption')?.remove();
    const box = el.getBoundingClientRect(), ring = document.createElement('div');
    ring.id = 'claude-caption';
    ring.style.cssText = `position:fixed;left:${box.left - 4}px;top:${box.top - 4}px;width:${box.width + 8}px;height:${box.height + 8}px;` +
      'border:3px solid #ff6a00;border-radius:6px;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 4px rgba(255,106,0,.25)';
    const tag = Object.assign(document.createElement('div'), {textContent: `Claude: ${caption}`});
    tag.style.cssText = 'position:absolute;left:0;top:-30px;white-space:nowrap;background:#ff6a00;color:#fff;font:600 13px system-ui;padding:4px 8px;border-radius:6px';
    ring.append(tag);
    document.body.append(ring);
    setTimeout(() => ring.remove(), 4000);
  }, caption);
  await locator.page().waitForTimeout(ms);
}

// The page's own state for each label: what the person would see, never a password's value.
const fieldStates = labels => labels.map(text => {
  const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[*:]/g, '').trim().toLowerCase();
  const label = [...document.querySelectorAll('label')].find(l => norm(l.textContent).startsWith(norm(text).slice(0, 40)));
  const target = label && (document.getElementById(label.htmlFor) || label.querySelector('input,select,textarea'));
  const area = target && (target.closest('tr, .row, .field') || target.parentElement?.parentElement);
  const visible = area ? [...area.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(e => e.getClientRects().length) : [];
  const el = target && target.type !== 'hidden' ? target : visible[0];
  if (!el) return {label: text, found: false};
  if (el.type === 'password') return {label: text, type: 'password'};
  return {label: text, tag: el.tagName, type: el.type, role: el.getAttribute('role'), value: el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : el.value,
    hidden: target?.type === 'hidden' ? target.value : undefined, marks: Object.keys(el.dataset).filter(key => key.startsWith('jobpilotto')),
    armed: !!el.closest('[data-jobpilotto-armed]') || !!area?.querySelector('[data-jobpilotto-armed]')};
});

const commands = {
  async inspect(id, part = 'http') {
    const app = await connect('cdp');
    const state = await appWindow(app.pages).evaluate(async id => (await window.pilot.reviewStates()).find(s => s.id === id) || null, id);
    await app.close();
    if (!state) return {id, state: 'no form report for this session'};
    const browser = await connect('browser');
    const tab = tabOf(browser.pages, state.url ? new URL(state.url).hostname : part);
    const fields = tab ? await tab.evaluate(fieldStates, state.pending || []) : 'its tab is not open';
    await browser.close();
    return {left: state.left, total: state.total, pending: state.pending, proposals: (state.proposals || []).map(p => ({label: p.label, value: p.value, key: p.key, options: (p.options || []).length})), fields};
  },
  async reopen(id) {
    const app = await connect('cdp');
    const went = await appWindow(app.pages).evaluate(async id => {
      const session = (await window.pilot.sessions()).find(s => s.id === id);
      if (!session) return 'no such session';
      const shown = await window.pilot.showBrowser(session.url, session.company, session.id);
      return shown?.went === 'none' ? `reopened: ${(await window.pilot.sessionReopen(session.id, true))?.ok}` : `went: ${shown?.went}`;
    }, id);
    await app.close();
    return went;
  },
  async click(part, selector, why = '') {
    const browser = await connect('browser');
    const tab = tabOf(browser.pages, part);
    if (!tab) { await browser.close(); throw new Error(`no tab with ${part}`); }
    const target = tab.locator(selector).first();
    const ours = await target.evaluate(el => !!el.getRootNode()?.host?.id?.startsWith('jobpilotto'));
    if (looksLikeSubmit(await target.evaluate(el => `${el.type === 'submit' && el.tagName === 'INPUT' ? 'submit' : ''} ${el.textContent || ''} ${el.value || ''}`), ours)) {
      await browser.close(); throw new Error('refused: that looks like the form\'s Submit');
    }
    await tab.bringToFront();
    await show(target, why || `clicking ${selector}`);
    await target.click();
    await tab.waitForTimeout(1000);
    await browser.close();
    return 'clicked';
  },
  async type(title, text) {
    const app = await connect('cdp');
    const win = appWindow(app.pages);
    const input = win.locator('li', {hasText: title}).filter({has: win.locator('input.ss-ask-input')}).first().locator('input.ss-ask-input');
    await win.bringToFront();
    await show(input, `typing "${text}" into ${title}, then Enter`);
    await input.fill(text);
    await input.press('Enter');
    await win.waitForTimeout(1500);
    await app.close();
    return 'typed';
  },
  async app(expression) {
    const app = await connect('cdp');
    const result = await appWindow(app.pages).evaluate(expression);
    await app.close();
    return result;
  },
  async page(part, expression) {
    const browser = await connect('browser');
    const tab = tabOf(browser.pages, part);
    const result = tab ? await tab.evaluate(expression) : `no tab with ${part}`;
    await browser.close();
    return result;
  },
  async shot(which, file) {
    const conn = await connect(which === 'app' ? 'cdp' : 'browser');
    const target = which === 'app' ? appWindow(conn.pages) : tabOf(conn.pages, which);
    await target.screenshot({path: file});
    await conn.close();
    return file;
  },
  async arrange() {
    const browser = await connect('browser');
    const tab = browser.pages.find(page => page.url().startsWith('http')) || browser.pages[0];
    const session = await browser.browser.newBrowserCDPSession();
    const {targetInfo} = await (await tab.context().newCDPSession(tab)).send('Target.getTargetInfo');
    const {windowId} = await session.send('Browser.getWindowForTarget', {targetId: targetInfo.targetId});
    await session.send('Browser.setWindowBounds', {windowId, bounds: {windowState: 'normal'}});
    await session.send('Browser.setWindowBounds', {windowId, bounds: {left: 860, top: 25, width: 860, height: 1000}});
    await tab.bringToFront();
    await browser.close();
    const app = await connect('cdp');
    await appWindow(app.pages).bringToFront();   // Electron does not let its window be placed from here: front only
    await app.close();
    return 'arranged: the browser on the right half, the app in front';
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [name, ...args] = process.argv.slice(2);
  if (!commands[name]) { console.error(`twin:drive commands: ${Object.keys(commands).join(', ')}`); process.exit(2); }
  commands[name](...args).then(result => console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1)),
    error => { console.error(`twin:drive ${name}: ${error.message}`); process.exit(1); });
}

/* global document, localStorage, innerWidth, innerHeight */
// Records the desktop app for the product media (desktop/scripts/media): demo mode on a temp copy of a persona folder, dark, a hidden window,
// never the owner's app, data folder or Keychain. Videos: a CDP screencast (works on a hidden window) + a click log for the renderer.
// Stills and close-ups: screenshots after the steps. Run by media.mjs; the steps come from scenes.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {clipTo} from './camera.mjs';
import {startScreencast, stepLog} from './screencast.mjs';
import {nav} from './scenes.mjs';

const desktop = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const {_electron: electron} = createRequire(path.join(desktop, 'e2e', 'package.json'))('playwright-core');
export const WINDOW = {width: 1440, height: 900};   // 16:10, the site's hero shape; the app's own zoom lays it out wider, Retina capture is 2x

// A temp copy of the persona folder (desktop/demo by default): the app reads and writes only there. jobs.json stays in the app (lib/demo.js).
function personaCopy(persona) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-media-'));
  for (const file of fs.readdirSync(persona)) {
    if (file !== 'jobs.json' && file !== 'media.json' && fs.statSync(path.join(persona, file)).isFile()) fs.copyFileSync(path.join(persona, file), path.join(data, file));
  }
  return data;
}

export async function launchApp({persona = path.join(desktop, 'demo')} = {}) {
  const data = personaCopy(persona);
  const app = await electron.launch({
    executablePath: path.join(desktop, 'node_modules', '.bin', 'electron'),   // a Mac (here or the CI runner): the site shows the Mac app
    args: [desktop],
    env: {...process.env, JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_USER_DATA: data, JOB_PILOTTO_CONFIG_DIR: data, JOB_PILOTTO_DATA_DIR: data,
      JOB_PILOTTO_THEME: 'dark', JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '1', JOB_PILOTTO_NO_DOTENV: '1', TZ: 'Europe/Zurich'},
    timeout: 90000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), WINDOW);
  await page.emulateMedia({colorScheme: 'dark'});   // Playwright emulates light unless told; the app's own default is dark
  await page.evaluate(() => localStorage.setItem('jp.menu.tour', 'done'));   // the first-run tour bubble would cover every screen
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  const close = async () => { await app.close().catch(() => {}); fs.rmSync(data, {recursive: true, force: true}); };
  return {app, page, data, close};
}

// One step on the app's page; `log` gets what the renderer needs (click targets, holds and their boxes).
async function step(page, item, log) {
  if (item.go) { await page.evaluate(selector => document.querySelector(selector)?.click(), nav(item.go)); await page.waitForTimeout(900); return; }
  if (item.js) { await page.evaluate(item.js); await page.waitForTimeout(900); return; }
  if (item.press) { await page.keyboard.press(item.press); await page.waitForTimeout(400); return; }
  if (item.click) {
    const target = page.locator(item.click).first();
    const box = await target.boundingBox();
    if (!box) throw new Error(`media: nothing to click at ${item.click} (has the screen changed? update scenes.mjs)`);
    log.add({type: 'click', selector: item.click, box});
    await page.waitForTimeout(700);   // the cursor's glide, drawn by the renderer
    log.add({type: 'press', selector: item.click, box});
    await target.click();
    return;
  }
  if (item.hold) {
    await page.waitForTimeout(250);
    const box = item.look ? await page.locator(item.look).first().boundingBox() : null;
    if (item.look && !box) throw new Error(`media: nothing to look at at ${item.look} (update scenes.mjs)`);
    log.add({type: 'hold', look: item.look || null, box, s: item.hold, ...(item.zoom ? {zoom: item.zoom} : {})});
    await page.waitForTimeout(item.hold * 1000 - 250);
  }
}

// A video piece: frames + log.json in `dir`. -> the log.
export async function recordAppVideo({persona, piece, dir}) {
  const {page, close} = await launchApp({persona});
  try {
    const cast = await startScreencast(page, path.join(dir, 'frames'));
    const log = stepLog(cast.clock);
    for (const item of piece.steps) await step(page, item, log);
    await page.waitForTimeout(200);
    const frames = await cast.stop();
    const result = {viewport: await viewportOf(page), frames, events: log.events, text: await pageText(page)};
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(result, null, 1));
    return result;
  } finally { await close(); }
}

// Stills and close-ups, all in one app session (each after its own steps, from Focus). -> [{name, file, kind, text}]
export async function shootApp({persona, stills, snips, dir}) {
  const {page, close} = await launchApp({persona});
  const shots = [];
  try {
    const log = stepLog(() => 0);
    for (const [name, still] of Object.entries(stills)) {
      await page.keyboard.press('Escape');
      for (const item of still.steps) await step(page, item, log);
      const file = path.join(dir, `still-${name}.png`);
      await page.screenshot({path: file});
      shots.push({name, kind: 'still', file, text: await pageText(page)});
    }
    for (const [name, snip] of Object.entries(snips)) {
      await page.keyboard.press('Escape');
      for (const item of snip.steps) await step(page, item, log);
      await page.locator(snip.selector).first().scrollIntoViewIfNeeded().catch(() => {});   // a card below the fold
      await page.waitForTimeout(300);
      const box = await page.locator(snip.selector).first().boundingBox();
      if (!box) throw new Error(`media: close-up ${name}: nothing at ${snip.selector} (update scenes.mjs)`);
      const view = await viewportOf(page), m = snip.margin;
      const clip = clipTo({x: box.x - m, y: box.y - m, width: box.width + 2 * m, height: box.height + 2 * m}, view);
      if (!clip) throw new Error(`media: close-up ${name}: ${snip.selector} is off screen`);
      const file = path.join(dir, `snip-${name}.png`);
      await page.screenshot({path: file, clip});
      shots.push({name, kind: 'snip', file, text: await pageText(page)});
    }
  } finally { await close(); }
  return shots;
}

// The page's size in CSS px (the app's zoom makes it wider than the window), the unit of every box in the log.
export const viewportOf = page => page.evaluate(() => ({w: innerWidth, h: innerHeight}));

// What the screen says, for the privacy check (check.mjs): the page's visible text.
const pageText = page => page.evaluate(() => document.body.innerText).catch(() => '');

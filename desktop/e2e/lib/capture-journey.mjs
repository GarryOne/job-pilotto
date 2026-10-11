/* global document */
// Every page a live run saw, each under its own address, for an offline replay of that run (speed-5x landing 1, owner 11 Oct 2026). It owns WHEN a page is
// kept: each frame of each tab (the main document and every iframe: a hosted form is its own page at its own address) is snapshotted once, the first time its
// shape (ready state, visible controls, text size) held for one turn of the run's watch loop: the page as it arrived, before the extension's presses changed
// it. What is kept of a page is lib/capture-page.mjs snapshotInPage (structure, applied CSS, no script, no value), then the caller's scrub.
// Used by lib/apply-live.mjs (tick() each turn of the watch, finish() and write() at the end). Guard: e2e/test/capture-journey.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {snapshotInPage} from './capture-page.mjs';

const MAX_PAGES = 20;
export const addressOf = url => String(url || '').replace(/[?#].*$/, '');
const kept = url => /^https?:\/\//.test(url);

// What makes a page "still arriving": its ready state, how many controls it shows, how much text (in steps of 500 characters).
function shapeInPage() {
  const shown = [...document.querySelectorAll('input, select, textarea, button, a, iframe, dialog')].filter(el => el.getClientRects().length).length;
  return `${document.readyState}|${shown}|${Math.round((document.body?.innerText || '').length / 500)}`;
}

// -> {tick(), finish(), write(dir) -> [{url, file, frameOf?}]}. scrub: html -> html (the person's values out), applied to every page.
export function journeyRecorder(context, {scrub = html => html} = {}) {
  const pages = new Map(), shapes = new Map();   // address -> {url, html, frameOf}; address -> last shape seen
  const frames = () => context.pages().filter(page => kept(page.url())).flatMap(page => page.frames().filter(frame => kept(frame.url())).map(frame => ({frame, page})));
  const snap = async (frame, page) => {
    const address = addressOf(frame.url());
    const html = await frame.evaluate(snapshotInPage).catch(() => '');
    if (!html || pages.size >= MAX_PAGES) return;
    const parent = frame === page.mainFrame() ? '' : addressOf(frame.parentFrame()?.url());
    pages.set(address, {url: address, html: scrub(html), ...(parent ? {frameOf: parent} : {})});
  };
  return {
    async tick() {
      for (const {frame, page} of frames()) {
        const address = addressOf(frame.url());
        if (pages.has(address)) continue;
        const shape = await frame.evaluate(shapeInPage).catch(() => null);
        if (!shape) continue;
        if (shape === shapes.get(address) && shape.startsWith('complete')) await snap(frame, page);
        else shapes.set(address, shape);
      }
    },
    // The run ends: a page still arriving at the end is kept as it is now.
    async finish() { for (const {frame, page} of frames()) if (!pages.has(addressOf(frame.url()))) await snap(frame, page); },
    write(dir) {
      fs.mkdirSync(path.join(dir, 'pages'), {recursive: true});
      const list = [...pages.values()].map((item, at) => {
        const file = `pages/${at + 1}.html`;
        fs.writeFileSync(path.join(dir, file), item.html);
        return {url: item.url, file, ...(item.frameOf ? {frameOf: item.frameOf} : {})};
      });
      fs.writeFileSync(path.join(dir, 'journey.json'), `${JSON.stringify(list, null, 1)}\n`);
      return list;
    },
  };
}

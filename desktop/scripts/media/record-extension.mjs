/* global document, location, innerWidth, innerHeight */
// Records the REAL extension filling a fictional form (form.html, served at a reserved .example address) for the product media
// (desktop/scripts/media). Isolation is the e2e harness's (e2e/lib/real-extension.mjs): a copy of the extension that talks only to a stand-in app,
// a throwaway Chromium profile, no network (every other host resolves to nothing). The stand-in hands over the persona's fictional details and
// answers the form's questions as Claude would for them. Nothing is pressed: the extension fills a marked tab by itself, as after the app's Apply.
// Never submitted: the form's button does nothing.
import fs from 'node:fs';
import path from 'node:path';
import {startRealExtension} from '../../e2e/lib/real-extension.mjs';
import {startScreencast, stepLog} from './screencast.mjs';
import {answerReply, formHost, formHtml} from './stand-in.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
export const VIEW = {width: 1440, height: 900};   // 16:10, captured at 2x

const panelBox = page => page.evaluate(() => {
  const host = document.getElementById('jobpilotto-review-host');
  const card = host?.shadowRoot?.querySelector('.card, .jp, [class*=panel]') || host;
  const r = card?.getBoundingClientRect();
  return r && r.width ? {x: r.x, y: r.y, width: r.width, height: r.height} : null;
});

export async function recordExtensionVideo({persona, piece, dir}) {
  const template = fs.readFileSync(path.join(here, 'form.html'), 'utf8');
  const ext = await startRealExtension({allowAllSites: true, offline: true, contact: persona.applicant,
    answer: {'/extension/answer': body => answerReply(body, persona.answers),
      '/extension/page-kind': () => ({ok: true, kind: 'form', role: 'form', by: 'ai', confidence: 0.95, signal: 'confident'})}});
  try {
    const {page, context} = ext;
    const host = formHost(persona.job);
    await context.route(`https://${host}/**`, route => route.fulfill({status: 200, contentType: 'text/html', body: formHtml(template, persona.job)}));
    await page.setViewportSize(VIEW);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {width: VIEW.width, height: VIEW.height, deviceScaleFactor: 2, mobile: false});
    await page.goto(`https://${host}/jobs/apply`);
    await ext.assertIsolated();
    const cast = await startScreencast(page, path.join(dir, 'frames'));
    const log = stepLog(cast.clock);
    for (const item of piece.steps) {
      if (item.fill) {   // what the app's Apply does: the tab, marked for the extension, which then reads and fills the form by itself
        await page.evaluate(() => { location.hash = 'jobpilotto-fill'; });
        await page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('button'), null, {timeout: 20000});
        log.add({type: 'mark'});
        continue;
      }
      if (item.hold) {
        await page.waitForTimeout(250);
        const box = item.look === 'panel' ? await panelBox(page) : item.look ? await page.locator(item.look).first().boundingBox() : null;
        log.add({type: 'hold', look: item.look || null, box, s: item.hold, ...(item.poster ? {poster: true} : {})});
        await page.waitForTimeout(item.hold * 1000 - 250);
      }
    }
    const frames = await cast.stop();
    const filled = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
      .filter(e => (e.type === 'checkbox' ? e.checked : e.type === 'file' ? e.files.length : e.value)).map(e => e.id));
    const result = {viewport: await page.evaluate(() => ({w: innerWidth, h: innerHeight})), frames, events: log.events, filled, text: await page.evaluate(() => document.body.innerText)};
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(result, null, 1));
    return result;
  } finally { await ext.close(); }
}

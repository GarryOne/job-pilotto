/* global document */
// Recall: how many KNOWN bugs the detectors catch. Each plant puts one defect into the real app page (inside #recall-plant, in the page showing), runs the detector
// that should catch it, and takes it out again. Without this, "the Finder got better" counts only false positives, never what it misses (3 Oct 2026).
// Planted errors are removed from the journey's record afterwards, so they are never filed as real window errors.
import {inspect, LIMITS} from './uicheck.mjs';
import {checkA11y} from './a11y.mjs';
import {probePage} from './interact.mjs';
import {journey} from './journey.mjs';

export const PLANTS = [
  {id: 'json-error-text', detector: 'layout', expect: 'error-shown', html: '<p class="message">400 {"type":"error","error":{"type":"invalid_request_error","message":"usage"},"request_id":"req_recall"}</p>'},
  {id: 'stack-trace-text', detector: 'layout', expect: 'error-shown', html: '<div>TypeError: x is undefined at render (file:///app/renderer/pages/x.js:12:5)</div>'},
  {id: 'object-object-text', detector: 'layout', expect: 'error-shown', html: '<span>Status: [object Object]</span>'},
  {id: 'page-overflow', detector: 'layout', expect: 'page-overflow', html: '<div style="width:4000px;height:8px;background:#ccc"></div>'},
  {id: 'broken-image', detector: 'layout', expect: 'broken-image', html: '<img src="file:///nonexistent-recall-plant.png" alt="logo" style="width:24px;height:24px">'},
  {id: 'unnamed-button', detector: 'layout', expect: 'unnamed-control', html: '<button style="width:32px;height:32px"></button>'},
  {id: 'tiny-text', detector: 'layout', expect: 'tiny-text', html: '<p style="font-size:7px">Fine print nobody can read</p>'},
  {id: 'a11y-button-name', detector: 'a11y', expect: 'button-name', html: '<button style="width:32px;height:32px"></button>'},
  {id: 'a11y-contrast', detector: 'a11y', expect: 'color-contrast', html: '<p style="color:#f2f2f2;background:#ffffff;font-size:14px">This sentence is too pale to read</p>'},
  {id: 'dead-button', detector: 'probe', expect: 'dead-control', html: '<button>More filters</button>'},   // not "Apply …": the probe never presses apply
  {id: 'broken-expander', detector: 'probe', expect: 'expand-broken', html: '<button aria-expanded="false" aria-controls="recall-x">Show details</button><div id="recall-x" hidden>details</div>'},
  {id: 'uncaught-error', detector: 'journey', expect: 'recall planted error', run: () => setTimeout(() => { throw new Error('recall planted error'); }, 0)},
  {id: 'unhandled-rejection', detector: 'journey', expect: 'recall planted rejection', run: () => { Promise.reject(new Error('recall planted rejection')); }},
];

const insert = html => { document.getElementById('recall-plant')?.remove(); const box = document.createElement('div'); box.id = 'recall-plant'; box.innerHTML = html; (document.querySelector('.view:not([hidden])') || document.body).append(box); };
const takeOut = () => document.getElementById('recall-plant')?.remove();

// -> {planted, caught, rows: [{id, detector, caught, saw}]}. `view`: the page showing; `ipc`: as for the probe.
export async function measureRecall({page, view, ipc, wait = ms => new Promise(done => setTimeout(done, ms))}) {
  const rows = [];
  // What the page already has before any plant: a detector "caught" a plant only when its count for that kind or rule went UP.
  const count = (list, key, value) => list.filter(item => item[key] === value).length;
  await page.evaluate(takeOut).catch(() => {});
  const baseLayout = await page.evaluate(inspect, {view, limits: LIMITS}).catch(() => []);
  const baseA11y = await checkA11y(page);
  for (const plant of PLANTS) {
    let caught = false, saw = '';
    try {
      if (plant.html) { await page.evaluate(insert, plant.html); await wait(400); }
      if (plant.detector === 'layout') {
        const found = await page.evaluate(inspect, {view, limits: LIMITS});
        caught = count(found, 'kind', plant.expect) > count(baseLayout, 'kind', plant.expect); saw = found.map(item => item.kind).join(',');
      } else if (plant.detector === 'a11y') {
        const found = await checkA11y(page);
        const nodes = (list, rule) => list.filter(item => item.rule === rule).reduce((sum, item) => sum + item.nodes, 0);
        caught = nodes(found, plant.expect) > nodes(baseA11y, plant.expect); saw = found.map(item => item.rule).join(',');
      } else if (plant.detector === 'probe') {
        const {findings} = await probePage({page, view, ipc, scope: '#recall-plant', settleMs: 900, idleMs: 0});
        caught = findings.some(item => item.kind === plant.expect); saw = findings.map(item => item.kind).join(',');
      } else if (plant.detector === 'journey') {
        await page.evaluate(plant.run); await wait(500);
        caught = [...journey.pageErrors, ...journey.consoleErrors].some(text => text.includes(plant.expect)); saw = caught ? 'recorded' : 'not recorded';
      }
    } catch (error) { saw = `error: ${String(error.message).slice(0, 80)}`; }
    await page.evaluate(takeOut).catch(() => {});
    rows.push({id: plant.id, detector: plant.detector, caught, saw: saw.slice(0, 160)});
  }
  // The planted window errors are not real ones: never filed.
  for (const list of [journey.pageErrors, journey.consoleErrors]) for (let i = list.length - 1; i >= 0; i--) if (/recall planted/.test(list[i])) list.splice(i, 1);
  return {planted: rows.length, caught: rows.filter(row => row.caught).length, rows};
}

// A plant a detector missed is a finding about the detector (medium, never a failed journey: a weaker check must not block a release).
export const recallFindings = result => result.rows.filter(row => !row.caught).map(row => ({view: 'recall', severity: 'warning', kind: 'detector-miss',
  detail: `${row.id} was planted for the ${row.detector} check and not caught (it saw: ${row.saw || 'nothing'})`}));

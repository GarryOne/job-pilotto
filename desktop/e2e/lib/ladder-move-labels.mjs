// Expected moves for the ladder fixtures, only from what a run's page CONFIRMED (spec docs/superpowers/specs/2026-10-12-one-next-move.md, box 7): a pool run pressed a control on the
// fixture's page and the next page was a form (the expected effect of an apply-type press). Reads a run's evidence folder (app.log: the extension's own press line; ai-calls.json: the page-kind
// requests the app received, with their page address and answer), joins the page to a fixture by its address without query, and the pressed label to the fixture's numbered candidates by
// their own text. A label no candidate carries is a finding (the list lacked the control the run pressed), never a guess. Pure parts; the CLI is e2e/ladder-label-moves.mjs.
// Guard: test/ladder-move-labels.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {noPhone, stripQuery} from './ladder-scrub.mjs';

const PRESS = /^(\S+) \[extension\] fill: pressed the Apply button (\{.*\})\s*$/;
const FORM = ['form', 'form_in_frame'];
const textKey = text => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const pageKey = url => noPhone(stripQuery(url)).replace(/\/$/, '');   // scrubbed as the fixture's own address was (a long number in the path is "(phone)")
const hostOf = url => { try { return new URL(url).host; } catch { return ''; } };
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

// Every folder under the roots that holds a run's evidence (an ai-calls.json beside an app.log), sorted.
export function evidenceDirs(roots) {
  const found = [];
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    if (entries.some(entry => entry.name === 'ai-calls.json') && entries.some(entry => entry.name === 'app.log')) found.push(dir);
    for (const entry of entries) if (entry.isDirectory()) walk(path.join(dir, entry.name));
  };
  for (const root of roots) walk(root);
  return found.sort();
}

// -> [{url, label, version, at}]: each Apply press of the run whose next page-kind answer (same host, after the press) was a form, with the page it was pressed on
// (the last page-kind request of that host before the press that was not a form).
export function confirmedPresses(dir) {
  let calls;
  try { calls = JSON.parse(readText(path.join(dir, 'ai-calls.json'))); } catch { return []; }
  if (!Array.isArray(calls)) return [];
  const pages = calls.filter(call => call?.route === '/extension/page-kind' && call.request?.url && Number.isFinite(call.at))
    .map(call => ({at: call.at, url: call.request.url, host: hostOf(call.request.url), kind: call.answer?.kind || ''}));
  const found = [];
  for (const line of readText(path.join(dir, 'app.log')).split('\n')) {
    const match = PRESS.exec(line);
    if (!match) continue;
    let press;
    try { press = JSON.parse(match[2]); } catch { continue; }
    const at = Date.parse(match[1]);
    if (!press.label || !Number.isFinite(at)) continue;
    const before = pages.filter(page => page.at <= at && page.host === press.host && !FORM.includes(page.kind)).at(-1);
    const after = pages.find(page => page.at > at && FORM.includes(page.kind));
    if (before && after) found.push({url: before.url, label: press.label, version: press.version || '', at});
  }
  return found;
}

// The numbers of the candidates whose own text is the pressed label (case and spacing aside). [] = no candidate carries it.
export const numbersFor = (candidates, label) => (candidates || []).filter(item => textKey(item.text) === textKey(label)).map(item => item.n);

// Joins presses to fixtures. A fixture is labelled only when it is a posting (a press is its move) with candidates. -> {labels: [{id, verb, candidates, confirmed}], unlisted: [{id, label, run}]}
// Several runs that pressed different listed controls on the same page all count (each led to the form). `run` names the evidence folder as <day>/<row>.
export function labelMoves(fixtures, runs) {
  const byPage = new Map();
  for (const fixture of fixtures) if (fixture.expect?.outcome === 'posting' && Array.isArray(fixture.candidates) && fixture.sketch?.url) byPage.set(pageKey(fixture.sketch.url), fixture);
  const labels = new Map(), unlisted = [];
  for (const {run, presses} of runs) for (const press of presses) {
    const fixture = byPage.get(pageKey(press.url));
    if (!fixture) continue;
    const numbers = numbersFor(fixture.candidates, press.label);
    if (!numbers.length) { unlisted.push({id: fixture.id, label: press.label, run, version: press.version}); continue; }
    const label = labels.get(fixture.id) || {id: fixture.id, verb: 'press', candidates: [], confirmed: {by: 'pool', run, version: press.version}};
    label.candidates = [...new Set([...label.candidates, ...numbers])].sort((a, b) => a - b);
    labels.set(fixture.id, label);
  }
  // A page whose pressed control no candidate carries (and no listed control was pressed on it in another run): the move the list could not name is `not_listed`, confirmed by the run that pressed it.
  for (const item of unlisted) if (!labels.has(item.id)) labels.set(item.id, {id: item.id, verb: 'not_listed', candidates: [], confirmed: {by: 'pool', run: item.run, version: item.version || ''}});
  return {labels: [...labels.values()].sort((a, b) => a.id.localeCompare(b.id)), unlisted};
}

// The run's name as <day>/<row folder> (the evidence layout: .../evidence/<day>/<row>).
export const runName = dir => dir.split(path.sep).slice(-2).join('/');

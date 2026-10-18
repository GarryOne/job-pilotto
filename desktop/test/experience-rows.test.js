// Profile → Experience, the read view (owner review fix 6, mockup 09, 18 Oct 2026): the sources as one line, each job a Work history row (letter tile,
// company, role, dates, place, "+N details" from other versions that opens the bullets and says what N counts).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
globalThis.window.pilot = new Proxy({}, {get: () => () => null});   // the page module loads core.js; no call is made here
const {roleBlock, sourcesSummary} = await import('../renderer/pages/experience.js');
const all = node => [node, ...(node.children || []).flatMap(each => all(each))];

test('sources in one line: the main CV, LinkedIn, other CV versions', () => {
  assert.equal(sourcesSummary({main: {roles: 2}, sources: []}), 'Main CV');
  assert.equal(sourcesSummary({main: {roles: 2}, sources: [{kind: 'cv'}]}), 'Main CV + 1 other CV version');
  assert.equal(sourcesSummary({main: {roles: 2}, sources: [{kind: 'linkedin'}, {kind: 'cv'}, {kind: 'cv'}]}), 'Main CV + LinkedIn + 2 other CV versions');
  assert.equal(sourcesSummary({main: null, sources: []}), 'Main CV not read yet');
});

test('a job row: initial tile, company, role, dates and place; details from other versions counted and named', () => {
  const role = {company: 'Northwind Robotics', title: 'Platform Engineer', period: 'Mar 2023 – Present', place: 'Zurich, CH',
    bullets: [{text: 'Moved 40 services to **Kubernetes**', from: 'Main CV'}, {text: 'Ran the on-call rota', from: 'CV 2024'}]};
  const row = roleBlock(role), text = row.textContent;
  for (const words of ['Northwind Robotics', 'Platform Engineer', 'Mar 2023 – Present', 'Zurich, CH', '+1 detail']) assert.match(text, new RegExp(words.replace('+', '\\+')));
  assert.equal(all(row).find(node => String(node.className).includes('job-initial')).textContent, 'N');
  assert.match(text, /1 detail from other CV versions/);
  assert.match(text, /Moved 40 services to Kubernetes/);
  assert.doesNotMatch(roleBlock({...role, place: '', bullets: [role.bullets[0]]}).textContent, /\+\d|other CV versions/);
});

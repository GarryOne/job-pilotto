// Settings → Profile → Experience: its tab, its two panels, the page module's hooks and the four actions the window calls
// (renderer/pages/experience.js, lib/experience-handlers.js). The data and the AI match are guarded by experience.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../renderer/index.html'), profile = read('../renderer/pages/profile.js'), page = read('../renderer/pages/experience.js');
const preload = read('../preload.cjs'), handlers = read('../lib/experience-handlers.js');

test('the Experience tab opens its two panels and loads them', () => {
  assert.match(html, /data-profile-tab="experience"/);
  for (const id of ['setting-experience-profile', 'setting-experience-sources', 'setting-experience-roles']) assert.match(html, new RegExp(`id="${id}"[^>]*data-profile-panel="experience"`), id);
  for (const id of ['exp-add', 'exp-add-linkedin', 'exp-sources', 'exp-roles', 'exp-count', 'exp-message']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(profile, /name === 'experience'\) loadExperience\(\)/);
  assert.match(profile, /initExperience\(\)/);
});

test('every action the page calls is exposed to the window and answered by the app', () => {
  for (const name of ['experienceGet', 'experienceAddCv', 'experienceAddLinkedin', 'experienceRemove', 'experienceRematch']) {
    assert.match(page + profile, new RegExp(`pilot\\.${name}|${name}`), `${name} is called`);
    assert.match(preload, new RegExp(`${name}: call\\('${name}'\\)`), `${name} is in the preload`);
    assert.match(handlers, new RegExp(`ipcMain.handle\\('${name}'`), `${name} has a handler`);
  }
});

test('"Match again" sits on the stale source\'s own row, and roles only in other versions have their own list', () => {
  const stale = page.slice(page.indexOf('for (const [i, source] of view.sources.entries())'), page.indexOf("const button = Object.assign(el('button', 'link item-action', 'Remove')"));
  assert.match(stale, /if \(source\.stale\)[\s\S]*'Match again'[\s\S]*row\.append\(again\)/);
  assert.doesNotMatch(page, /rows\[0\]\?\.append/);
  assert.match(page, /'Not in your main CV'/);
  assert.match(page, /filter\(source => !source\.stale\)/, 'a stale match is not listed');
});

test('every action that changes the bank shows its live steps and what it changed', () => {
  // The class: add a CV (many files), add LinkedIn, match again, remove. Each answers with `changes`, and the window shows them.
  assert.match(handlers, /properties: \['openFile', 'multiSelections'\]/, 'several CV files can be chosen at once');
  for (const name of ['experienceAddCv', 'experienceAddLinkedin', 'experienceRemove', 'experienceRematch']) {
    const body = handlers.slice(handlers.indexOf(`ipcMain.handle('${name}'`)).split('ipcMain.handle(')[1];
    assert.match(body, /withChanges\(before/, `${name} answers with what changed`);
  }
  for (const name of ['experienceAddCv', 'experienceAddLinkedin', 'experienceRematch']) assert.match(handlers.slice(handlers.indexOf(`ipcMain.handle('${name}'`)).split('ipcMain.handle(')[1], /onStep: what => step\(/, `${name} reports steps`);
  assert.match(preload, /onExperienceStep/);
  assert.match(page, /onExperienceStep\?\.\(step =>/);
  assert.match(page, /showChanges\(answer\)/);
  assert.match(html, /id="exp-versions"/); assert.match(html, /id="exp-changes"/);
});

test('the other versions are one box that opens and closes, with Remove on each row', () => {
  assert.match(page, /export function versionsBlock[\s\S]*'details', 'exp-role'/);
  assert.match(page, /'Remove'/);
});

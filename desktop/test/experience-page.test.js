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
  for (const id of ['setting-experience-sources', 'setting-experience-roles']) assert.match(html, new RegExp(`id="${id}"[^>]*data-profile-panel="experience"`), id);
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

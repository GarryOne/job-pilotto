// A part of a Settings → Profile tab that the code shows on a condition ("Which is right?", Your details' unsaved-changes bar, "Your CV changed")
// shows on its own tab only (17 Oct 2026: "Which is right?" and the Your details save bar showed on the Preferences tab). The class: every element
// in index.html with data-profile-panel that the code shows by itself goes through pages/tab-part.js showOnTab and starts data-wanted="0".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const renderer = new URL('../renderer/', import.meta.url);
const html = fs.readFileSync(new URL('index.html', renderer), 'utf8');
const panels = [...html.matchAll(/<[a-z]+\s[^>]*\bid="([^"]+)"[^>]*>/g)].filter(([tag]) => /data-profile-panel="/.test(tag)).map(([tag, id]) => ({id, tag}));
const sources = fs.readdirSync(new URL('pages/', renderer)).filter(name => name.endsWith('.js'))
  .map(name => [name, fs.readFileSync(new URL(`pages/${name}`, renderer), 'utf8')]);   // a URL, never .pathname (Windows)

test('every Profile tab part the code shows by itself goes through showOnTab and starts unwanted', () => {
  assert.ok(panels.length > 10, 'the Profile panels are found');
  const conditional = [];
  for (const {id, tag} of panels) {
    const plain = sources.filter(([, text]) => new RegExp(`\\bshow\\(\\$\\('${id}'\\)`).test(text)).map(([name]) => name);
    assert.deepEqual(plain, [], `#${id} is shown with show(): use showOnTab, else it leaks onto other Profile tabs`);
    if (sources.some(([, text]) => text.includes(`showOnTab($('${id}')`))) {
      conditional.push(id);
      assert.match(tag, /data-wanted="0"/, `#${id} starts unwanted`);
    }
  }
  assert.deepEqual(conditional.sort(), ['contact-savebar', 'cv-changed', 'setting-which']);
});

test('switching tabs keeps a part\'s wish', () => {
  const profile = sources.find(([name]) => name === 'profile.js')[1];
  assert.match(profile, /show\(panel, panel\.dataset\.profilePanel === name && panel\.dataset\.wanted !== '0'\)/);
});

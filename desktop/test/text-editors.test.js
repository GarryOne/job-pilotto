// Settings → Profile (renderer/pages/text-editors.js + index.html): one editor for each text, and no Notion-only control on another store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');

test('the Profile text has its editor panel; the answers and Form knowledge are one Application answers tab (16 Oct 2026)', () => {
  assert.match(html, /data-text-editor="profile"/);
  assert.match(profile + read('../renderer/pages/profile-form.js'), /loadTextEditor\('profile'\)/);
  assert.match(html, /data-profile-tab="answers">Application answers</);
  assert.doesNotMatch(html, /data-profile-tab="knowledge"/, 'Form knowledge is a section of Application answers');
  assert.match(profile, /if \(name === 'knowledge'\) name = 'answers';/, 'a link to the old tab opens the merged one');
  assert.match(profile, /if \(name === 'answers'\) loadApplicationAnswers\(\);/);
});

test('every Notion button on the Profile page is Notion-only (hidden on this Mac)', () => {
  const page = html.slice(html.indexOf('data-settings-page="profile"'), html.indexOf('data-settings-page="automation"'));
  const buttons = [...page.matchAll(/<button[^>]*>[^<]*Notion[^<]*<\/button>/g)].map(match => match[0]);
  assert.ok(buttons.length >= 3);
  for (const button of buttons) assert.match(button, /data-notion-only/, button);
  assert.doesNotMatch(page, /<(span|b)(?![^>]*data-store-saved)[^>]*>Saved in Notion</, 'where it is saved is said by the store');
});

// Settings → Profile (renderer/pages/text-editors.js + index.html): one editor for each text, and no Notion-only control on another store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');

test('each of the store\'s texts has its editor panel, opened by its tab', () => {
  for (const name of ['profile', 'answers', 'knowledge']) {
    assert.match(html, new RegExp(`data-text-editor="${name}"`), name);
    assert.match(profile, new RegExp(`loadTextEditor\\('${name}'\\)`), name);
  }
  for (const tab of ['profiletext', 'knowledge']) assert.match(html, new RegExp(`data-profile-tab="${tab}"`));
});

test('every Notion button on the Profile page is Notion-only (hidden on this Mac)', () => {
  const page = html.slice(html.indexOf('data-settings-page="profile"'), html.indexOf('data-settings-page="automation"'));
  const buttons = [...page.matchAll(/<button[^>]*>[^<]*Notion[^<]*<\/button>/g)].map(match => match[0]);
  assert.ok(buttons.length >= 3);
  for (const button of buttons) assert.match(button, /data-notion-only/, button);
  assert.match(profile, /edit\.dataset\.notionOnly = ''/);
  assert.doesNotMatch(page, /<(span|b)(?![^>]*data-store-saved)[^>]*>Saved in Notion</, 'where it is saved is said by the store');
});

// Settings → Profile's tabs (index.html + pages/profile.js): the rest of the Profile and Application answers (the standard answers + Form knowledge,
// merged 16 Oct 2026) and Strategy's Job preferences are drawn from their texts' outlines on every store; no textarea; every Notion button is Notion-only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../renderer/index.html'), profile = read('../renderer/pages/profile.js');
const page = html.slice(html.indexOf('data-settings-page="profile"'), html.indexOf('data-settings-page="automation"'));

test('the tabs: the rest of the Profile and Application answers open their outline tabs; Form knowledge is a section, its old tab name still lands there', () => {
  assert.match(html, /data-profile-tab="profiletext">Preferences</);
  assert.match(html, /data-profile-tab="answers">Application answers</);
  assert.doesNotMatch(html, /data-profile-tab="knowledge"/);
  assert.match(profile, /if \(name === 'knowledge'\) name = 'answers';/);
  assert.match(profile, /if \(name === 'answers'\) loadApplicationAnswers\(\);/);
  assert.match(profile, /else if \(name === 'profiletext'\) loadProfileRest\(\);/);
  for (const [file, texts] of [['application-answers', "\\[TEXT, 'knowledge'\\]"], ['job-preferences', '\\[TEXT\\]'], ['profile-rest', '\\[TEXT\\]']]) {
    assert.match(read(`../renderer/pages/${file}.js`), new RegExp(`outlineTab\\('\\w+', ${texts}`), file);
  }
});

test('no textarea anywhere on the Profile page\'s texts (owner, 16 Oct 2026)', () => {
  for (const file of ['outline-tab', 'application-answers', 'website-rules', 'job-preferences', 'profile-rest']) {
    assert.doesNotMatch(read(`../renderer/pages/${file}.js`), /'textarea'/, file);
  }
  assert.doesNotMatch(page.slice(page.indexOf('id="setting-answers"')), /<textarea/);
});

test('every Notion button on the Profile page is Notion-only (hidden on this Mac)', () => {
  const buttons = [...page.matchAll(/<button[^>]*>[^<]*Notion[^<]*<\/button>/g)].map(match => match[0]);
  assert.ok(buttons.length >= 3);
  for (const button of buttons) assert.match(button, /data-notion-only/, button);
  assert.doesNotMatch(page, /<(span|b)(?![^>]*data-store-saved)[^>]*>Saved in Notion</, 'where it is saved is said by the store');
});

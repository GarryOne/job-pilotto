// The setup's Always on step in the main app's card style (owner, 24 Oct 2026): shared card parts, the news consent apart from the search, the example marked, the privacy line kept.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {EXAMPLE_JOBS, NEWS, NEWS_HINT, STORED} from '../renderer/hosted-words.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const strip = text => text.replace(/\/\/.*$/gm, '');

test('the step is built from the shared card parts, with no one-off CSS or inline styles', () => {
  const parts = strip(read('renderer/hosted-step-parts.js')), page = strip(read('renderer/pages/hosted.js'));
  assert.match(parts, /cardHead\(/);
  assert.match(parts, /switch-line/);
  assert.doesNotMatch(parts + page, /\.style\.|style=|createElement\('style'\)/);
  assert.ok(!fs.existsSync(new URL('../renderer/hosted-step.css', import.meta.url)));
});

test('the product news consent is its own card and switch, apart from the daily search, and starts on but can be switched off', () => {
  const page = strip(read('renderer/pages/hosted.js'));
  assert.match(page, /switchRow\('hosted-daily'/);
  assert.match(page, /switchRow\('hosted-news', NEWS, true, NEWS_HINT\)/);
  const stepBody = page.slice(page.indexOf('export function mountStep'), page.indexOf('// Settings: the card'));
  assert.match(stepBody, /search = alwaysOnCard\([^;]*hosted-daily[^;]*emailField\('hosted-email'\)\);/s);   // news is not an argument of the search card
  assert.doesNotMatch(stepBody.match(/search = alwaysOnCard\(.*\);/s)[0].split('const news')[0], /hosted-news/);
  assert.match(NEWS, /unsubscribe in one click/);
  assert.match(NEWS_HINT, /Separate/);
});

test('the example e-mail is demo data only and marked as an example; the privacy line stays on the step', () => {
  assert.ok(EXAMPLE_JOBS.length >= 2);
  assert.match(read('renderer/hosted-step-parts.js'), /Example of a morning e-mail/);
  assert.match(strip(read('renderer/pages/hosted.js')), /el\('p', 'muted small', STORED\)/);
  assert.match(STORED, /encrypted.*deleted/);
});

test('every id the flow and e2e rely on is still drawn, and both buttons keep their ids', () => {
  const page = read('renderer/pages/hosted.js');
  for (const id of ['hosted-daily', 'hosted-email', 'hosted-news', 'hosted-skip', 'hosted-go', 'hosted-message']) assert.ok(page.includes(id), id);
});

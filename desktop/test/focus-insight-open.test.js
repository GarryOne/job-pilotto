// Focus → the Insight card's button (pages/focus.js renderInsight): its Notion page when there is one, else the same thing in the app:
// an insight in Reports (the weekly report on Weekly), a rejection on its job's Review tab. Never a missing button on a store without pages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const page = fs.readFileSync(new URL('../renderer/pages/focus.js', import.meta.url), 'utf8');
const body = page.slice(page.indexOf('function renderInsight('), page.indexOf('\nfunction ', page.indexOf('function renderInsight(') + 10));

test('the button is drawn for every insight with somewhere to go, not only with a Notion page', () => {
  assert.doesNotMatch(body, /if \(insight\.notion_url\) box\.append/);
  assert.match(body, /const open = insight\.notion_url \? event => openLink\(insight\.notion_url, event\)/);
  assert.match(body, /insight\.report \? \(\) => \{ openView\('reports'\); loadReports\(insight\.reason === 'Weekly report' \? 'weekly' : 'insights'\); \}/);
  assert.match(body, /insight\.url \? \(\) => \{ openView\('jobs'\); openJobPanel\(\{url: insight\.url, title: insight\.title, company: insight\.company\}, 'review'\); \}/);
  assert.match(body, /if \(open\) box\.append\(focusButton\(/);
});

// A sticky page save bar never covers another bar or a button (owner, 18 Oct 2026; the Profile save bar slid over Expand all / Collapse all on a short tab):
// Profile's fold bar and save bar sit in one sticky dock, stacked; every page's save bar sticks at the bottom edge, never lifted for a bar that is not there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

test('Profile: the fold bar and the save bar share one sticky dock, neither sticky on its own inside it', () => {
  const html = read('index.html'), dock = html.indexOf('id="profile-dock"');
  assert.ok(dock > 0 && html.indexOf('id="profile-foldbar"') > dock, 'the fold bar sits inside the dock');
  assert.match(read('pages/profile-save-bar.js'), /host: document\.getElementById\('profile-dock'\)/, 'the save bar is put in the same dock');
  assert.match(read('card-shell.css'), /\.page-dock > \.foldbar, \.page-dock > \.save-bar \{ position: static;/);
});

test('class: every page that makes a save bar (pageSaveBar) gets it at the bottom edge; only a dock stacks it with another bar', () => {
  assert.match(read('style.css'), /\.save-bar \{ position: sticky; bottom: 0;/, 'no offset for a bar some pages do not have');
  const sticky = ['components.css', 'style.css', 'card-shell.css', 'roomy-cards.css', 'strategy-cards.css'].flatMap(file => read(file).split('\n').filter(line => /^\.[\w-]*bar\b[^{]*\{[^}]*position: sticky; bottom:/.test(line)).map(line => `${file}: ${line.slice(0, 40)}`));
  assert.deepEqual(sticky.map(line => line.split(':')[0]).sort(), ['components.css', 'style.css'], `the fold bar and the save bar are the only bottom bars; a new one docks with them: ${sticky}`);
});

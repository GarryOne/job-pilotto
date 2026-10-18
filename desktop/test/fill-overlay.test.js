// The fill overlay's contracts, read from the source (the browser test is desktop/e2e/test/fill-overlay.test.mjs): every debugger input goes through the driver gap, every end removes the overlay,
// and the overlay is hidden from the AI's picture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sources = dir => fs.readdirSync(new URL(`../../${dir}`, import.meta.url), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? sources(`${dir}${entry.name}/`) : entry.name.endsWith('.js') ? [`${dir}${entry.name}`] : []);

test('every extension file that sends debugger input does it inside driving() (a new one added without the gap fails here)', () => {
  const files = sources('extension/').filter(path => /Input\.dispatch(Mouse|Key)Event|Input\.insertText/.test(read(path)));
  assert.ok(files.length >= 3, 'positive control: the known input senders are found');
  for (const path of files) assert.match(read(path), /\bdriving\(/, `${path} sends input through the debugger without the driver gap (extension/input-gap.js): the overlay would block it`);
});

test('the overlay is invisible to hit-tests, ends on every way out, and is hidden from the picture', () => {
  const overlay = read('extension/panel-overlay.js');
  assert.match(overlay, /pointer-events:\s*none/, 'a layer that takes no hit-test: elementFromPoint, on-top and the clicks of the driver see the page');
  assert.match(overlay, /ID = 'jobpilotto-fill-overlay'/, 'its id starts with jobpilotto: every page read already skips it');
  assert.match(overlay, /chrome\.runtime\?\.id/, 'an extension reload lifts it');
  assert.match(overlay, /MAX_MS/, 'a backstop lifts it when no step refreshes it');
  for (const path of ['extension/stop.js', 'extension/settle-tabs.js']) assert.match(read(path), /jobpilotto-fill-overlay/, `${path} removes the overlay with the other page marks`);
  assert.match(read('extension/ladder/rung4-page-picture.js'), /jobpilotto-fill-overlay/, 'the AI\'s picture never shows the dim layer');
  assert.match(read('extension/panel-files.js'), /panel-overlay\.js/);
  assert.match(read('extension/panel-markup.js'), /\.jp\.working \{ zoom: 1\.3; \}/, 'the panel is larger while filling');
});

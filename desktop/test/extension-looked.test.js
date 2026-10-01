// The words that say where the extension was looked for (renderer/extension-looked.js). They exist for the machine
// where it isn't found and the reason isn't "it isn't installed": a browser started with --user-data-dir, or one the
// app doesn't know, keeps its profile somewhere no list here can guess.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {lookedText} from '../renderer/extension-looked.js';

const chrome = {browser: 'Google Chrome', dir: 'Google/Chrome/User Data', at: '/x/Google/Chrome/User Data', there: true};
const vivaldi = {browser: 'Vivaldi', dir: 'Vivaldi/User Data', at: '/x/Vivaldi/User Data', there: false};

test('the folders looked in are named, and which of them is on this computer', () => {
  assert.equal(lookedText([chrome, vivaldi]),
    'Looked in Google/Chrome/User Data and Vivaldi/User Data. On this computer: Google/Chrome/User Data.');
  assert.equal(lookedText([chrome]),
    'Looked in Google/Chrome/User Data. On this computer: Google/Chrome/User Data.');
  assert.equal(lookedText([chrome, {browser: 'Chromium', dir: 'Chromium/User Data', at: '/x/c', there: true}, vivaldi]),
    'Looked in Google/Chrome/User Data, Chromium/User Data and Vivaldi/User Data. On this computer: Google/Chrome/User Data and Chromium/User Data.');
});

test('when none of them is there, it says where to look instead', () => {
  const text = lookedText([vivaldi]);
  assert.match(text, /^Looked in Vivaldi\/User Data\. /);
  assert.match(text, /None of those folders is on this computer/);
  assert.match(text, /--user-data-dir/);
  assert.match(text, /chrome:\/\/version shows the browser's real Profile Path/);
});

test('nothing to say when the app was told nothing', () => {
  assert.equal(lookedText([]), '');
  assert.equal(lookedText(undefined), '');
});

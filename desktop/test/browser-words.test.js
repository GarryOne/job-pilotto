// The extension card's wording follows the browser the extension is in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserWords, inBrowser} from '../renderer/browser-words.js';

test('Edge: the card says Edge and edge://extensions; Chrome and unknown browsers keep Chrome\'s words', () => {
  assert.deepEqual(browserWords('Microsoft Edge'), {name: 'Edge', scheme: 'edge', extensionsUrl: 'edge://extensions'});
  assert.equal(browserWords('').name, 'Chrome');
  assert.equal(inBrowser('In Chrome: open chrome://extensions → Load unpacked. Chrome isn\'t running.', 'Microsoft Edge'),
    'In Edge: open edge://extensions → Load unpacked. Edge isn\'t running.');
  assert.equal(inBrowser('In Chrome: open chrome://extensions', 'Google Chrome'), 'In Chrome: open chrome://extensions');
  assert.equal(inBrowser('Chromebook', 'Microsoft Edge'), 'Chromebook');  // a word boundary, not a substring
});

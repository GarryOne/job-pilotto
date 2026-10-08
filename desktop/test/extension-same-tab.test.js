// Apply in the same tab (extension/same-tab.js): only a tab opened right after the extension pressed Apply is folded back.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FOLD_MS, foldInto, foldableUrl} from '../../extension/same-tab.js';

test('a tab opened by the posting right after Apply was pressed loads in the posting tab', () => {
  const pressed = new Map([[7, 1000]]);
  assert.equal(foldInto({id: 9, openerTabId: 7}, pressed, 1000 + 2000), 7);              // Manor: Apply → career55.sapsf.eu in a new tab
  assert.equal(foldInto({id: 9, openerTabId: 7}, pressed, 1000 + FOLD_MS + 1), null);    // a pop-up the page opens later: left alone
  assert.equal(foldInto({id: 9, openerTabId: 8}, pressed, 1500), null);                  // another tab's child
  assert.equal(foldInto({id: 9}, pressed, 1500), null);                                  // a tab the user opened
});

test('only a web address is loaded in the posting tab', () => {
  assert.equal(foldableUrl('https://career55.sapsf.eu/careers?x=1'), 'https://career55.sapsf.eu/careers?x=1');
  assert.equal(foldableUrl('about:blank'), '');
  assert.equal(foldableUrl('chrome://downloads'), '');
  assert.equal(foldableUrl(undefined), '');
});

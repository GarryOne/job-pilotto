// E2E_BROWSER=msedge runs the extension in Edge; anything else keeps Playwright's Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserChannel} from '../lib/extension.mjs';

test('the apply suite uses Edge only when asked', () => {
  assert.deepEqual(browserChannel({E2E_BROWSER: 'msedge'}), {channel: 'msedge'});
  assert.deepEqual(browserChannel({}), {});
  assert.deepEqual(browserChannel({E2E_BROWSER: 'chrome'}), {});
});

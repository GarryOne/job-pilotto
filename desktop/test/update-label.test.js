// The update button is one short line: the version (and "beta"), never the release's long title (it wrapped to three lines, 4 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {updateLabel, updateTooltip} from '../renderer/update-label.js';

test('the button names the version and the channel in a few words; the full release title is in the tooltip', () => {
  const beta = {version: '0.5.1', beta: true, name: '🧪 BETA (release candidate) · 0.5.1 · 4 Oct', url: 'https://x/r'};
  assert.equal(updateLabel(beta), 'Update to 0.5.1 beta');
  assert.equal(updateLabel({version: '0.5.2', name: '0.5.2 · 5 Oct'}), 'Update to 0.5.2');
  assert.equal(updateLabel({version: '0.5.0', rollback: true}), 'Back to 0.5.0');
  assert.match(updateTooltip(beta), /^🧪 BETA \(release candidate\) · 0\.5\.1 · 4 Oct is ready/);
  assert.ok(updateLabel(beta).length <= 22, 'fits one line of the sidebar');
});

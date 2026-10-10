// Why the page-kind AI's named Apply button was not pressed (extension/ladder/press-why.js): fixed flags and counts only, never a page's text.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {whyNotPressed} from '../../extension/ladder/press-why.js';

const link = (text, extra = {}) => ({index: 0, tag: 'a', text, area: 4000, visible: true, disabled: false, href: '', submits: false, ...extra});

test('no name, no answer: nothing to explain', () => {
  assert.equal(whyNotPressed([link('Apply')], ''), null);
  assert.deepEqual(whyNotPressed([], 'Apply'), {found: 0, pickable: false});
});

test('each reason a named control is not pressed is a flag, and the text never leaves', () => {
  const named = 'Jetzt bewerben (ohne Anmeldung)';
  const cases = [
    [[link(named)], {found: 1, visible: 1, enabled: 1, submits: 0, hrefNone: 1, pickable: true}],
    [[link(named, {visible: false})], {found: 1, visible: 0, enabled: 1, submits: 0, hrefNone: 1, pickable: false}],
    [[link(named, {disabled: true})], {found: 1, visible: 1, enabled: 0, submits: 0, hrefNone: 1, pickable: false}],
    [[link(named, {submits: true, href: '/x'})], {found: 1, visible: 1, enabled: 1, submits: 1, hrefPage: 1, pickable: false}],
    [[link(named, {href: '#'}), link(` ${named.toUpperCase()} `, {href: 'mailto:a@b.c'})], {found: 2, visible: 2, enabled: 2, submits: 0, hrefHash: 1, hrefOther: 1, pickable: true}],
    [[link('Jetzt bewerben (mit Anmeldung)')], {found: 0, pickable: false}],
  ];
  for (const [candidates, want] of cases) assert.deepEqual(whyNotPressed(candidates, named), want);
  assert.equal(JSON.stringify(whyNotPressed([link(named)], named)).includes('bewerben'), false);
});

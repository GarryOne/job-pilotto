// A control's structural fingerprint (extension/page/skeleton.js): the same widget on two sites, in any state, with any build
// hashes, has the same name; different widgets do not; nothing a person typed or the page says is in it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const load = () => {
  const module = {exports: {}};
  new Function('module', 'window', fs.readFileSync(new URL('../../extension/page/skeleton.js', import.meta.url), 'utf8'))(module, {});
  return module.exports;
};
const kit = load();
const el = (tag, attrs = {}, kids = [], className = '') => ({tagName: tag.toUpperCase(), className, children: kids, getAttribute: name => (name in attrs ? attrs[name] : null)});
const toggles = (pressed, hash, extra = {}) => el('div', {}, [
  el('button', {'aria-pressed': pressed, ...extra}, [], `_option_${hash}_32 ashby-yesno-option`),
  el('button', {'aria-pressed': 'false'}, [], `_option_${hash}_32 ashby-yesno-option`),
  el('input', {type: 'checkbox'})], `_yesno_${hash}_148 ashby-yesno`);

test('the same toggle pair has one fingerprint, whatever its state or build hashes', () => {
  assert.equal(kit.fingerprint(kit.skeleton(toggles('false', '1svni'))), kit.fingerprint(kit.skeleton(toggles('true', 'zq81x'))));
});

test('different widgets, and a different number of options, have different fingerprints', () => {
  const pair = kit.fingerprint(kit.skeleton(toggles('false', 'aaaaa')));
  const three = el('div', {}, [0, 1, 2].map(() => el('button', {'aria-pressed': 'false'}, [], '_option_aaaaa_32 ashby-yesno-option')), '_yesno_aaaaa_148 ashby-yesno');
  const select = el('div', {role: 'combobox', 'aria-haspopup': 'listbox'}, [], 'custom-select');
  assert.equal(new Set([pair, kit.fingerprint(kit.skeleton(three)), kit.fingerprint(kit.skeleton(select))]).size, 3);
});

test('build hashes and library noise are dropped from class names, words are kept', () => {
  assert.deepEqual(kit.classWords(el('div', {}, [], '_yesno_1e3gg_148 css-1x2y3z a1b2c3d ashby-yesno x')), ['ashby-yesno', 'yesno']);
});

test('a skeleton holds no text, value, placeholder, name, id or address', () => {
  const secret = 'Igor Mardari 1 Rue du Lac';
  const control = el('div', {role: 'radiogroup', id: secret, name: secret, placeholder: secret, value: secret, title: secret, href: secret, 'aria-label': secret},
    [el('button', {'aria-pressed': 'true', 'data-option': secret, 'aria-label': secret}, [], 'option')], 'group');
  control.textContent = secret;
  const json = JSON.stringify(kit.skeleton(control));
  assert.doesNotMatch(json, /Igor|Mardari|Rue|Lac/);
  assert.match(json, /radiogroup/);
});

test('widgets are found by what they do: switches, radio groups, custom selects, pressable groups; a lone button is not one', () => {
  const nodes = {
    '[role=switch]': [el('div', {role: 'switch'})],
    '[role=radiogroup]': [el('div', {role: 'radiogroup'})],
    'button[aria-haspopup=listbox], div[role=combobox], button[role=combobox]': [el('button', {'aria-haspopup': 'listbox'})],
  };
  const group = el('div');
  const buttons = [{parentElement: group}, {parentElement: group}, {parentElement: el('div')}];
  const root = {querySelectorAll: selector => (selector.startsWith('button[aria-pressed]') ? buttons : nodes[selector] || [])};
  const kinds = kit.widgets(root).map(widget => widget.kind).sort();
  assert.deepEqual(kinds, ['custom-select', 'radiogroup', 'switch', 'toggle-group']);
  assert.deepEqual(kit.widgets(root, () => false), []);
});

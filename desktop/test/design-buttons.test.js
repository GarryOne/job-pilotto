// Icons alone only on secondary buttons (owner, 18 Oct 2026: "let's leave icons only for secondary buttons"; docs/rules/desktop-ui.md): every renderer file is read and
// a button that is primary and icon-only (class "primary" with "icon-btn", or a primary built from an icon and nothing else) fails here with its file and line.
// The UI check's `icon-only-primary` (e2e/lib/uicheck.mjs) catches the same on every rendered view.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const files = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []));

// A class list (in quotes or a template) naming both primary and icon-btn; or el('button', '...primary...', icon(...)) with no words after the icon.
const RULES = [/['`"][^'`"\n]*\bprimary\b[^'`"\n]*\bicon-btn\b[^'`"\n]*['`"]|['`"][^'`"\n]*\bicon-btn\b[^'`"\n]*\bprimary\b[^'`"\n]*['`"]/, /el\(\s*'button'\s*,\s*['`][^'`]*\bprimary\b[^'`]*['`]\s*,\s*icon\([^)]*\)\s*\)/];

export const iconOnlyPrimaries = text => text.split('\n').flatMap((line, i) => (RULES.some(rule => rule.test(line)) ? [{line: i + 1, text: line.trim().slice(0, 120)}] : []));

test('the check itself: it catches an icon-only primary and leaves words and secondary icons alone', () => {
  assert.equal(iconOnlyPrimaries("const b = el('button', 'primary icon-btn', icon('play'));").length, 1);
  assert.equal(iconOnlyPrimaries("const b = el('button', 'primary', icon('play'));").length, 1);
  assert.equal(iconOnlyPrimaries("const b = el('button', 'secondary icon-btn', icon('play'));").length, 0);
  assert.equal(iconOnlyPrimaries("const b = el('button', 'primary', 'Fill now');").length, 0);
});

test('no renderer file builds a primary button out of an icon alone', () => {
  const found = files(renderer).flatMap(file => iconOnlyPrimaries(fs.readFileSync(file, 'utf8')).map(hit => `${path.relative(renderer, file)}:${hit.line} ${hit.text}`));
  assert.deepEqual(found, [], `a primary button shows its words; an icon alone is for secondary buttons (docs/rules/desktop-ui.md):\n${found.join('\n')}`);
});

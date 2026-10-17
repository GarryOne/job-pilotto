// Free text boxes guard (design system, owner 17 Oct 2026: "Let's use the proper field types"): a value with a kind (yes/no, a choice, a date, an
// amount, a salary, a duration, a link, a country, a language, a range, a list) is edited with its typed control (renderer/question-control.js
// answerControl, or chips), never a plain text box. Every free text box the window draws today is counted per file in text-fields-allowed.json;
// a file that draws more fails here. Rules: docs/rules/desktop-ui.md "Value → control".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(here, '..', 'renderer');
const ALLOWED = JSON.parse(fs.readFileSync(path.join(here, 'text-fields-allowed.json'), 'utf8'));
// The typed controls themselves draw their text and number parts: they are the answer, not the problem.
const CONTROLS = new Set(['question-control.js', 'question-control-values.js', 'question-control-composite.js']);

const JS_BOX = /createElement\(['"](input|textarea)['"]\)|\bel\(['"](input|textarea)['"]|type: ['"]text['"]/;
const NOT_TEXT = /type: ['"](checkbox|radio|number|date|file|range|hidden|color|time|month)['"]|type = ['"](checkbox|radio|number|date|file|range|hidden)['"]/;
// -> how many lines of a script make a free text box (one line = one box).
export const jsBoxes = source => source.replace(/\/\/.*$/gm, '').split('\n').filter(line => JS_BOX.test(line) && !NOT_TEXT.test(line)).length;
// -> how many <textarea> and text <input> the markup holds.
export const htmlBoxes = source => (source.replace(/<!--[\s\S]*?-->/g, '').match(/<textarea\b|<input\b(?![^>]*type="(?!text"|search")[^"]*")[^>]*>/g) || []).length;

function counts() {
  const out = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name), rel = path.relative(renderer, full).split(path.sep).join('/');
      if (entry.isDirectory()) { if (entry.name !== 'assets') walk(full); continue; }
      const n = entry.name.endsWith('.js') && !CONTROLS.has(rel) ? jsBoxes(fs.readFileSync(full, 'utf8')) : entry.name.endsWith('.html') ? htmlBoxes(fs.readFileSync(full, 'utf8')) : 0;
      if (n) out[rel] = n;
    }
  };
  walk(renderer);
  return out;
}

test('no screen adds a free text box beyond today\'s count (a typed value uses its typed control)', () => {
  const over = Object.entries(counts()).filter(([file, n]) => n > (ALLOWED[file] ?? 0))
    .map(([file, n]) => `renderer/${file}: ${n} free text boxes, ${ALLOWED[file] ?? 0} allowed`);
  assert.deepEqual(over, [], `\n${over.join('\n')}
Does the value have a kind (yes/no, one of a list, a date, an amount, a salary, a duration, a link, a country, a language + level, a range, several from a list)?
  → draw it with answerControl(formatFor(...)) from renderer/question-control.js, or chips (docs/rules/desktop-ui.md "Value → control").
Only words that are truly free (a name, a search, a message, a note for the AI) get a text box: then raise the file's count in test/text-fields-allowed.json.`);
});

test('the counter sees text boxes and skips typed inputs', () => {
  assert.equal(jsBoxes("const a = el('textarea', '');\nconst b = Object.assign(document.createElement('input'), {type: 'number'});\nconst c = Object.assign(el('input', ''), {type: 'text'}); // el('input')"), 2);
  assert.equal(htmlBoxes('<input id="a"><input type="checkbox"><input type="search" id="s"><textarea></textarea><!-- <input> -->'), 3);
});

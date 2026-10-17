// Settings → Profile → Cover letter: "Letter style", the "Cover letter style" section of the standard answers (owner, 17 Oct 2026: the Cover letter
// tab is the one home for letters; the style rules move there). The rules stay lines of the answers page, so every letter prompt keeps reading them
// (lib/job-letter.js, src/ai/kit.py); this tab edits them, Application answers no longer lists them. One input per rule and "Add a style rule",
// through pages/outline-tab.js's save bar, on every store. Guarded by test/letter-style.test.js.
import {el} from '../components.js';
import {sections} from '../answers-model.js';
import {lineInput, outlineTab} from './outline-tab.js';
import {input, labelled} from './website-rules.js';

const TEXT = 'answers';
export const STYLE_HEADING = 'Cover letter style';   // the app's own heading (lib/strategy.js asks the setup draft for it)
export const isStyle = title => /^cover letter style$/i.test(String(title || '').replace(/^[^\p{L}\p{N}]+/u, '').trim());
const typed = new Map();
let tab = null;

function draw(view, into) {
  const style = sections(view.items[TEXT] || []).find(section => isStyle(section.title));
  const grid = el('div', 'form-grid cols-2 pref-body');
  for (const item of style?.items || []) grid.append(lineInput(view, TEXT, {...item, label: item.question}, typed));
  if (!style) grid.append(el('p', 'muted span-all', 'No style rules yet: letters use a short, direct default (130–170 words).'));
  // A new rule: after the section's last line, or the section itself at the end of the page.
  const change = text => (style ? {op: 'insert', after: style.after, key: 'add-style', lines: [text]} : {op: 'section', heading: STYLE_HEADING, lines: [text]});
  const add = input(typed.get('add-style') || '', text => {
    if (!text.trim()) { typed.delete('add-style'); view.undo(TEXT, change('')); } else { typed.set('add-style', text); view.change(TEXT, change(text.trim())); }
  }, {placeholder: 'e.g. Never mention: salary', ariaLabel: 'Add a style rule'});
  grid.append(labelled('Add a style rule', add, true));
  into.append(grid);
}

export async function loadLetterStyle() {
  const node = document.getElementById('letter-style-body');
  if (!node) return;
  if (!tab || tab.node !== node) tab = {...outlineTab('letterstyle', [TEXT], node, draw, {onReset: () => typed.clear(), words: 'The next letters follow them once you save.'}), node};
  await tab.load();
}

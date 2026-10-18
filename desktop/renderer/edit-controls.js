// Editor controls the Profile cards share (design system, docs/rules/desktop-ui.md: the value's kind picks its control): a box that grows for long
// text, and chips with × plus "Add, then Enter" for several values from a list. They hold their own value and call onChange(value) on every edit;
// the card reads value() back. Used by renderer/survey-rows.js and renderer/experience-editors.js. Guarded by test/experience-editors.test.js.
import {chip, el} from './components.js';
import {answerControl} from './question-control.js';

const LONG = {kind: 'long_text', control: 'textarea', options: []};
const rowsFor = (text, least) => Math.max(least, Math.ceil(String(text || '').length / 80));
// A box that holds all of its text: as many rows as it wraps to (about 80 characters a row), at least `least`.
export function longText(value, label, placeholder = '', onInput = () => {}, {least = 2} = {}) {
  const box = answerControl(LONG, value, next => { box.rows = rowsFor(next, least); onInput(next); }, {ariaLabel: label, placeholder});
  box.rows = rowsFor(value, least);
  return box;
}

// Chips with × and an "Add, then Enter" field. split(text) turns what was typed into values (a list typed at once becomes several chips).
export function chipsInput(items, {placeholder = 'Add, then Enter', ariaLabel = placeholder, split = text => [text.trim()].filter(Boolean), onChange = () => {}} = {}) {
  let values = [...items];
  const box = el('div', 'values-input'), list = el('div', 'chip-list');
  const add = Object.assign(el('input', 'add'), {type: 'text', placeholder});
  add.setAttribute('aria-label', ariaLabel);
  const draw = () => list.replaceChildren(...values.map((value, i) => chip(value, {onRemove: event => {
    event?.preventDefault?.();
    values = values.filter((_, at) => at !== i);
    draw();
    onChange(values);
  }})));
  const commit = () => {
    const typed = split(add.value);
    if (!typed.length) return;
    values = [...values, ...typed];
    add.value = '';
    draw();
    onChange(values);
  };
  add.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); commit(); } });
  add.addEventListener('change', commit);
  draw();
  box.append(list, add);
  return {node: box, value: () => [...values], commit};
}

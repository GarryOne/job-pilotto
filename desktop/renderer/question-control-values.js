// The answer controls of a question that is a value, not a choice, and the segmented choice they share with question-control.js: a date (a calendar input,
// saved in the person's words, "1 December 2026"; a date question that also asks about constraints is complete only with "No constraints" or the
// constraints) and an amount (a number and a currency, saved "95000 CHF"). An answer saved as free text stays visible as it was written until the person
// picks a value: nothing is lost. Built from the shared parts (.segmented, native inputs); layout in question-review.css (.qa-values). Guarded by test/question-control.test.js.
import {el} from './components.js';
import {dateIso, dateWords, joinConstraints, splitAmount, splitConstraints} from './question-kind.js';

export function segmented(options, isOn, onPress, ariaLabel) {
  const group = el('div', 'segmented is-fill');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', ariaLabel);
  for (const option of options) {
    const button = Object.assign(el('button', isOn(option) ? 'is-active' : '', option), {type: 'button'});
    button.setAttribute('aria-pressed', String(isOn(option)));
    button.addEventListener('click', () => onPress(option, group));
    group.append(button);
  }
  return group;
}
export const refresh = (group, isOn) => group.querySelectorAll('button').forEach(button => {
  button.classList.toggle('is-active', isOn(button.textContent));
  button.setAttribute('aria-pressed', String(isOn(button.textContent)));
});

const NONE = 'No constraints', ADD = '+ Add constraints';
export const savedAs = text => el('p', 'muted small qa-saved-as', `Saved as: ${text}`);

// A composite control: a div whose .value is the answer and .complete says whether it can be confirmed.
export function composite(read, complete) {
  const node = el('div', 'qa-values');
  Object.defineProperty(node, 'value', {get: read, set: () => {}, configurable: true});
  Object.defineProperty(node, 'complete', {get: complete, configurable: true});
  return node;
}

// format: {constraints}; value: the saved answer; onChange(value).
export function dateControl(format, value, onChange, {ariaLabel = 'Answer'} = {}) {
  const asks = Boolean(format?.constraints);
  const start = asks ? splitConstraints(value) : {date: String(value ?? '').trim(), constraints: ''};
  let date = start.date, mode = start.constraints === 'none' ? 'none' : start.constraints ? 'add' : '', text = mode === 'add' ? start.constraints : '';
  const answer = () => joinConstraints(date, mode === 'none' ? 'none' : mode === 'add' ? text.trim() : '');
  const node = composite(answer, () => Boolean(date) && (!asks || mode === 'none' || (mode === 'add' && Boolean(text.trim()))));
  const input = Object.assign(el('input', ''), {type: 'date', value: dateIso(date), ariaLabel});
  const said = el('span', '');
  const note = () => said.replaceChildren(...(date && !dateIso(date) ? [savedAs(date)] : []));
  input.addEventListener('input', () => { date = dateWords(input.value); note(); onChange(answer()); });
  node.append(input, said);
  note();
  if (asks) {
    const notes = Object.assign(el('input', ''), {type: 'text', value: text, placeholder: 'Constraints on this date', ariaLabel: `${ariaLabel}: constraints`});
    notes.hidden = mode !== 'add';
    const isOn = option => (option === NONE && mode === 'none') || (option === ADD && mode === 'add');
    const group = segmented([NONE, ADD], isOn, (option, each) => {
      mode = isOn(option) ? '' : option === NONE ? 'none' : 'add';
      notes.hidden = mode !== 'add';
      refresh(each, isOn);
      onChange(answer());
    }, `${ariaLabel}: constraints`);
    notes.addEventListener('input', () => { text = notes.value; onChange(answer()); });
    node.append(group, notes);
  }
  return node;
}

// format: {options: the currencies}; value: the saved answer; onChange(value).
export function amountControl(format, value, onChange, {placeholder = 'Amount', ariaLabel = 'Answer'} = {}) {
  const currencies = [...(format?.options || [])], raw = String(value ?? '').trim(), start = splitAmount(raw);
  let number = start.number, currency = start.currency || currencies[0] || '';
  if (currency && !currencies.includes(currency)) currencies.push(currency);
  const answer = () => (number ? `${number} ${currency}`.trim() : raw && !start.number ? raw : '');
  const node = composite(answer, () => Boolean(answer()));
  node.classList.add('is-amount');
  const input = Object.assign(el('input', ''), {type: 'number', value: number, placeholder, ariaLabel});
  const select = Object.assign(el('select', ''), {ariaLabel: `${ariaLabel}: currency`});
  select.dataset.longList = '1';   // a currency is a long list by nature: a menu is right here (desktop/e2e/lib/design-rules.mjs small-select)
  for (const each of currencies) select.append(new Option(each, each));
  select.value = currency;
  input.addEventListener('input', () => { number = input.value; onChange(answer()); });
  select.addEventListener('change', () => { currency = select.value; onChange(answer()); });
  node.append(input, select);
  if (raw && !start.number) node.append(savedAs(raw));
  return node;
}

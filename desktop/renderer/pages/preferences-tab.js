// Settings → Profile → Preferences (owner's mockup, 16 Oct 2026): section cards Location & work style, Languages, Roles & employment, then
// Compensation, Other preferences and the rest of the Profile folded. Chips, segmented work modes, language levels, selects, workload min/max:
// each writes back only its own cell or line of the Profile (renderer/preferences-model.js), on every store, through pages/outline-tab.js's one
// save bar. No textarea, never a ❓ on screen. Guarded by test/profile-tabs-render.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {changeFor, shown} from '../answers-model.js';
import {FIELDS, GROUPS, LEVELS, MODES, chipsOf, chipsText, fieldChange, languagesOf, languagesText, modesOf, modesText, readProfile, workloadOf, workloadText} from '../preferences-model.js';
import {outlineTab} from './outline-tab.js';
import {input, labelled, select} from './website-rules.js';

const TEXT = 'profile';
const typed = new Map();   // field key or item id → the text as edited
let tab = null;
const folded = {pay: false, other: false, rest: false};
let langs = null;          // the language rows as edited (a new one has no name yet), from the field's text

// A field's current text, and the setter that drafts its change (or drops it when back to what the page says).
function binding(view, field, item, anchor) {
  const original = item?.value || '';
  return {
    text: () => typed.get(field.key) ?? original,
    set(text) {
      const change = fieldChange(field, item, text, anchor);
      if (text === original) { typed.delete(field.key); view.undo(TEXT, change); } else { typed.set(field.key, text); view.change(TEXT, change); }
    },
  };
}

function chips(view, field, bind) {
  const box = el('div', 'pref-chips');
  const list = el('div', 'chip-list');
  for (const [i, chip] of chipsOf(bind.text()).entries()) {
    const node = el('span', 'chip removable', chip);
    const x = Object.assign(el('button', 'x', '×'), {type: 'button', ariaLabel: `Remove ${chip}`});
    x.addEventListener('click', () => { const next = chipsOf(bind.text()); next.splice(i, 1); bind.set(chipsText(next)); view.redraw(); });
    node.append(x);
    list.append(node);
  }
  const add = Object.assign(el('input', ''), {type: 'text', placeholder: field.add, ariaLabel: field.add});
  const commit = () => { if (add.value.trim()) { bind.set(chipsText([...chipsOf(bind.text()), add.value.trim()])); view.redraw(); } };
  add.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault?.(); commit(); } });
  add.addEventListener('change', commit);
  box.append(list, add);
  return box;
}

function modes(view, bind) {
  const box = el('div', 'segmented is-fill pref-modes');
  const chosen = modesOf(bind.text());
  for (const mode of MODES) {
    const on = chosen.includes(mode);
    const button = Object.assign(el('button', on ? 'is-active' : '', mode), {type: 'button'});
    button.setAttribute('aria-pressed', String(on));
    button.addEventListener('click', () => { bind.set(modesText(on ? chosen.filter(m => m !== mode) : [...chosen, mode])); view.redraw(); });
    box.append(button);
  }
  return box;
}

function languages(view, bind) {
  const box = el('div', 'pref-languages');
  langs ||= languagesOf(bind.text());
  const list = langs;
  const write = () => bind.set(languagesText(list));
  list.forEach((language, i) => {
    const line = el('div', 'pref-language');
    const levels = [['', 'Select level'], ...[...new Set([...LEVELS, ...(language.level ? [language.level] : [])])].map(level => [level, level])];
    const x = Object.assign(el('button', 'link', icon('close')), {type: 'button', ariaLabel: `Remove ${language.name}`});
    x.addEventListener('click', () => { list.splice(i, 1); write(); view.redraw(); });
    line.append(input(language.name, value => { language.name = value; write(); }, {placeholder: 'Language', ariaLabel: 'Language'}),
      select(levels, language.level, value => { language.level = value; write(); }, 'Level'), x);
    box.append(line);
  });
  const add = Object.assign(el('button', 'secondary with-icon', icon('plus')), {type: 'button'});
  add.append('Add language');
  add.addEventListener('click', () => { list.push({name: '', level: ''}); view.redraw(); });
  box.append(add);
  return box;
}

function workload(bind) {
  const box = el('div', 'form-grid cols-2');
  const now = workloadOf(bind.text());
  const part = (key, text, placeholder) => {
    const field = Object.assign(el('input', ''), {type: 'number', min: 0, max: 100, value: now[key], placeholder, ariaLabel: text});
    field.addEventListener('input', () => { now[key] = field.value; bind.set(workloadText(now)); });
    return labelled(text, field);
  };
  box.append(part('min', 'Workload (minimum %)', 'e.g. 50'), part('max', 'Workload (maximum %)', 'e.g. 100'));
  return box;
}

function control(view, field, item, anchor) {
  const bind = binding(view, field, item, anchor);
  const hint = item?.hint ? `e.g. ${shown(item.hint)}` : field.placeholder || 'Not set';
  if (field.widget === 'chips') return labelled(field.label, chips(view, field, bind));
  if (field.widget === 'modes') return labelled(field.label, modes(view, bind));
  if (field.widget === 'languages') return labelled(field.label, languages(view, bind), true);
  if (field.widget === 'workload') { const box = workload(bind); box.classList.add('span-all'); return box; }
  if (field.widget === 'select') {
    const now = bind.text();
    const options = [['', 'Not set'], ...[...new Set([...field.options, ...(now ? [now] : [])])].map(option => [option, option])];
    return labelled(field.label, select(options, now, value => bind.set(value), field.label));
  }
  return labelled(field.label, input(bind.text(), value => bind.set(value), {placeholder: hint, ariaLabel: field.label}));
}

// A row of Other preferences or of the rest of the Profile: its label and one input (a line without a label is its own text).
function itemField(view, item) {
  const original = item.value;
  const field = input(typed.get(item.id) ?? original, text => {
    const change = changeFor(item, text);
    if (text === original) { typed.delete(item.id); view.undo(TEXT, change); } else { typed.set(item.id, text); view.change(TEXT, change); }
  }, {placeholder: item.hint ? `e.g. ${shown(item.hint)}` : 'Not set', ariaLabel: item.label || 'Line'});
  return labelled(item.label ? shown(item.label) : '', field, !item.label);
}

function card(key, body) {
  const group = GROUPS[key] || {title: 'The rest of your Profile', lead: 'Your summary, skills, experience and notes, line by line. The AI reads them with the rest.', icon: 'file-text', folded: true};
  const head = el(group.folded ? 'summary' : 'div', 'qa-section-head pref-head');
  const words = el('div', 'pref-words');
  words.append(el('h4', '', group.title), el('span', 'muted small', group.lead));
  head.append(icon(group.icon), words);
  const box = el(group.folded ? 'details' : 'section', 'answer-item qa-section pref-section');
  if (group.folded) { box.open = folded[key]; box.addEventListener('toggle', () => { folded[key] = box.open; }); }
  box.append(head, body);
  return box;
}

function draw(view, into) {
  const {fields, other, rest, anchor} = readProfile(view.items[TEXT] || []);
  for (const key of ['location', 'languages', 'roles', 'pay']) {
    const grid = el('div', 'form-grid cols-2 pref-body');
    for (const field of FIELDS.filter(each => each.group === key)) grid.append(control(view, field, fields[field.key], anchor));
    into.append(card(key, grid));
  }
  const others = el('div', 'form-grid cols-2 pref-body');
  if (other.length) for (const item of other) others.append(itemField(view, item));
  else others.append(el('p', 'muted span-all', 'Nothing else yet: rows you add to your Profile\'s Preferences show here.'));
  into.append(card('other', others));
  if (rest.length) {
    const lines = el('div', 'form-grid cols-2 pref-body');
    for (const entry of rest) lines.append(entry.heading ? el('h5', 'span-all pref-sub', shown(entry.heading)) : itemField(view, entry));
    into.append(card('rest', lines));
  }
}

export async function loadPreferences() {
  const node = document.getElementById('preferences-body');
  if (!node) return;
  if (!tab || tab.node !== node) tab = {...outlineTab('preferences', [TEXT], node, draw, {onReset: () => { typed.clear(); langs = null; }, words: 'Scores, kits and tailored CVs use them once you save.'}), node};
  await tab.load();
}

// Drawer → Review: the analysis of a rejection or a completed interview: "Reviewed by …" muted on top (as Kit's "Drafted by"), the verdict
// a callout, each section's lines a plain list, and the to-dos as the interview insights' "Practice next" steps (read-only here: the
// review is a record). Not available yet: a state card.
import {el} from '../components.js';
import {lineView, stateCard} from './parts.js';

const REVIEWED_BY = /^Reviewed by\b/;
const textOf = line => (typeof line === 'string' ? line : line.text ?? '');
function reviewSection(title, lines) {
  const todos = lines.filter(line => line.todo !== undefined && line.todo !== null);
  if (todos.length) {   // what to improve: the interview insights' steps
    const block = el('div', 'iv-practice');
    if (title) block.append(el('h3', '', title));
    todos.forEach((line, n) => {
      const row = el('div', `iv-step${line.todo ? ' is-done' : ''}`);
      const words = el('div', 'iv-row-words');
      words.append(el('b', '', line.text));
      const box = Object.assign(el('input', 'iv-step-box'), {type: 'checkbox', checked: !!line.todo, disabled: true});
      row.append(el('span', 'iv-step-n', String(n + 1)), words, box);
      block.append(row);
    });
    return block;
  }
  const box = el('div', 'iv-moments-group');
  if (title) box.append(el('h3', '', title));
  const list = el('ul', 'insight-evidence');
  lines.forEach(line => list.append(line.fold !== undefined ? lineView(line) : el('li', '', textOf(line))));
  box.append(list);
  return box;
}

export function reviewTab({parts}) {
  const groups = parts.groups.review;
  if (!groups.length) return [stateCard({icon: 'search', title: 'No review yet', text: 'Available after rejection feedback or a completed interview.'})];
  const out = [], by = [];
  groups.forEach((part, index) => {
    const lines = part.lines.filter(line => !(REVIEWED_BY.test(textOf(line)) && by.push(textOf(line))));
    let rest = lines;
    if (!part.title && index === 0 && lines.length) {   // the head: the verdict first
      out.push(el('div', 'callout', textOf(lines[0])));
      rest = lines.slice(1);
    }
    // A bold line inside a group is a section's heading ("Evidence", "What to improve next time").
    let section = {title: part.title, lines: []};
    const sections = [section];
    for (const line of rest) {
      if (line.strong) sections.push(section = {title: textOf(line), lines: []});
      else section.lines.push(line);
    }
    out.push(...sections.filter(each => each.lines.length).map(each => reviewSection(each.title, each.lines)));
  });
  return [...by.map(text => el('p', 'muted small', text)), ...out];
}

// Jobs page, the Find jobs card folded to one line while a search runs (owner, 19 Oct 2026): a pulsing dot, "Searching..." cycling, sites read of total,
// jobs listed, on your list, time left, and a thin bar; a click anywhere on the card opens the full card and a click folds it back. The choice is kept per
// viewer (localStorage). Also the live dot on each progress line. Model: renderer/find-card-model.js. Guarded by: test/find-card-folded.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {foldedParts} from '../find-card-model.js';

const KEY = 'jobsFindFolded';
export const isFolded = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };   // folded unless the viewer opened it
export const setFolded = folded => { try { localStorage.setItem(KEY, folded ? '1' : '0'); } catch {} };

export function foldedLine(model) {
  const row = el('div', 'find-line');
  const searching = el('b', 'find-line-title');
  searching.append('Searching', el('span', 'find-dots'));
  row.append(el('span', 'live-dot is-live'), searching);
  foldedParts(model).forEach(part => row.append(el('span', 'find-line-part muted', part)));
  const chevron = el('span', 'find-line-chevron'); chevron.append(icon('chevron'));
  row.append(chevron);
  const pieces = [row];
  if (model.employers) {
    const {done, total} = model.employers, bar = el('div', 'bar find-line-bar'), fill = el('span');
    fill.style.width = `${total ? Math.max(2, Math.min(100, Math.round(100 * done / total))) : 2}%`;
    bar.append(fill); pieces.push(bar);
  }
  return pieces;
}

// One live line: a dot that grows and shrinks on the newest line and rests (green) on the ones before it.
export const liveRow = (text, newest) => {
  const li = el('li', 'run-card-row live-row');
  li.append(el('span', `live-dot${newest ? ' is-live' : ''}`), el('span', '', text));
  return li;
};

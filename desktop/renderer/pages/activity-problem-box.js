// The amber box a run that did not end well is drawn in on the Actions result card: the same parts as Recent activity's box (#activity-warnings), from the same run-status words.
// Guarded by desktop/test/no-result-card.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {rerunSites} from '../visits-card.js';
import {shared} from './shared.js';
import {runButton, kindOf} from './activity-basics.js';

// head: noResultHead() (run-status.js). onFix: the button's action (run again / read again / open a page); onLog: opens the technical log. Either may be missing: no button.
export function problemBox(head, {onFix, onLog} = {}) {
  const actions = el('div', 'alert-actions');
  if (head.fix && onFix) actions.append(Object.assign(el('button', 'primary', head.fix.label), {type: 'button', onclick: onFix}));
  if (onLog) actions.append(Object.assign(el('a', 'link', 'View technical log'), {href: '#', onclick: event => { event.preventDefault(); event.currentTarget.blur(); onLog(); }}));
  const title = el('div', 'ap-warn-head');
  title.append(el('span', 'ap-warn-icon'), el('strong', '', head.title));
  title.firstChild.append(icon('alert'));
  const words = el('div', 'ap-warn-words');
  words.append(title, el('p', '', head.summary), ...(actions.childElementCount ? [actions] : []));
  const box = el('div', `alert tone-${head.tone || 'warn'} activity-warnings run-problem`);
  box.append(words);
  return box;
}

// "Run again": the task's own Run button on the Actions page, so it queues, joins and reports like any other run (a browser run: the dialog ticks this run's sites).
export function rerunKind(kind, sites) {
  if (kind === 'visits' && sites) shared.visitsPreselect = sites;
  runButton(kind)?.click();
}
export const rerunTask = run => rerunKind(kindOf(run), kindOf(run) === 'visits' ? rerunSites(run.log || []) : null);

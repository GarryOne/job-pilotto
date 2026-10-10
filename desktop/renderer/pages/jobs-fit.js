// Jobs page, match analysis: the panel a score ring opens (parts as bars, risk, strengths and gaps). Guarded by: npm run shot -- jobs (no unit test reads it).
import {el} from '../components.js';
import {icon} from '../icons.js';
import {band} from '../jobs-view.js';

// Match analysis (the panel a score ring opens): the score's four parts as bars, risk on its own line (lower is
// better), then what speaks for the job and what against. Notion Job Matches keeps all of it.
const PARTS = [['role_fit', 'Role fit'], ['location', 'Location'], ['compensation', 'Pay fit'], ['growth', 'Growth']];
const FIT_LISTS = [['good', 'Why it fits', 'strengths'], ['warn', 'What to check', 'gaps']];
// One of those two lists: a circled tick (or bang) and a line each, on the tone's soft background.
function fitCard(tone, title, text) {
  const items = String(text || '').split(/;\s+/).filter(Boolean);
  if (!items.length) return null;
  const card = el('div', `fit-card tone-${tone}`);
  const ul = el('ul');
  ul.append(...items.map(item => {
    const li = el('li');
    const mark = el('span', 'fit-mark');
    mark.append(icon(tone === 'good' ? 'check-circle' : 'bang-circle'));
    li.append(mark, el('span', '', item));
    return li;
  }));
  card.append(el('b', 'fit-card-title', title), ul);
  return card;
}
// close: the list's Collapse; full: "Open full details" (the drawer's Match tab). Either is left out where it has no meaning (the drawer's own Match tab).
export function fitDetail(job, close = null, full = null) {
  const {parts = {}, strengths = '', gaps = ''} = job.fit_detail || {};
  const box = el('div', 'fit-detail');
  const head = el('div', 'fit-head');
  head.append(el('b', 'fit-title', 'Match analysis'));
  // The second way to close it, next to the ring (Collapse: the standard wording for one).
  if (full) {
    const open = Object.assign(el('button', 'link', 'Open full details'), {type: 'button'});
    open.addEventListener('click', full);
    head.append(open);
  }
  if (close) {
    const collapse = Object.assign(el('button', 'fit-collapse', 'Collapse'), {type: 'button'});
    collapse.append(icon('chevron'));
    collapse.addEventListener('click', close);
    head.append(collapse);
  }
  const lead = el('div', 'fit-lead');
  lead.append(head);
  if (job.reason) lead.append(el('p', 'fit-summary', job.reason));
  box.append(lead);
  const metrics = PARTS.filter(([key]) => parts[key] != null).map(([key, label]) => {
    const cell = el('div', `fit-metric ${band(parts[key])}`);
    cell.style.setProperty('--p', parts[key]);
    const value = el('span', 'fit-metric-value');
    value.append(el('b', '', String(parts[key])), el('span', 'muted', '/ 100'));
    const track = el('span', 'fit-bar');
    track.append(el('span', 'fit-bar-fill'));
    cell.append(el('span', 'fit-metric-label', label), value, track);
    return cell;
  });
  if (metrics.length) {
    const strip = el('div', 'fit-metrics');
    strip.append(...metrics);
    box.append(strip);
  }
  if (parts.risk != null) {
    const risk = el('p', `fit-risk ${band(100 - parts.risk)}`);
    risk.append(icon('alert'), el('b', 'fit-risk-label', 'Risk'), el('b', '', String(parts.risk)),
      el('span', 'muted', '/ 100 · Lower is better'));
    box.append(risk);
  }
  const cards = FIT_LISTS.map(([tone, title, key]) => fitCard(tone, title, key === 'strengths' ? strengths : gaps)).filter(Boolean);
  if (cards.length) {
    const row = el('div', 'fit-cards');
    row.append(...cards);
    box.append(row);
  }
  return box;
}

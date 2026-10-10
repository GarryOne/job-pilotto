// Drawer → Overview (owner's mock, 10 Oct 2026): "At a glance" (six fact tiles), "What the role involves" (a line each, the technologies as
// chips), "Worth clarifying" (what the score says to check) and "From your conversations" (what the calls said). Each part shows only
// when it has something; a job with none of it says so once. Words: renderer/job-page-view.js.
import {el, tag} from '../components.js';
import {callFacts, clarifyOf, foundLine, glanceTiles, lines, matchView, technologiesOf} from '../job-page-view.js';
import {card, factTile, iconRow, stateCard} from './parts.js';

const GLANCE = {salary: ['coins', 'good'], mode: ['building', 'violet'], contract: ['file', 'info'], seniority: ['chart', 'signal'],
  languages: ['users', 'violet'], posted: ['calendar', 'info']};
const ROW_ICONS = ['settings', 'layers', 'user', 'target'];

function glance(match, job) {
  const grid = el('div', 'jd-tiles');
  grid.append(...glanceTiles(match).map(tile => factTile({...tile, icon: GLANCE[tile.key][0], tone: tile.known ? GLANCE[tile.key][1] : 'neutral'})));
  const found = foundLine(job, match);
  return card('At a glance', grid, ...(found ? [el('p', 'muted small jd-found', found)] : []));
}

function involves(match) {
  const rows = lines(match?.responsibilities), tech = technologiesOf(match);
  if (!rows.length && !match?.reason && !tech.length) return null;
  const parts = (rows.length ? rows : [match.reason].filter(Boolean)).map((text, n) => iconRow(ROW_ICONS[n % ROW_ICONS.length], text));
  if (tech.length) {
    const chips = el('div', 'jd-tech');
    chips.append(el('b', '', 'Technologies'), ...tech.map(name => tag(name)));
    parts.push(chips);
  }
  return card('What the role involves', ...parts);
}

function listOf(items) {
  const list = el('ul', 'jd-list');
  list.append(...items.map(text => el('li', '', text)));
  return list;
}

export function overviewTab({job, page}) {
  const match = matchView(job, page);
  const nodes = [];
  if (match) nodes.push(glance(match, job));
  const role = involves(match);
  if (role) nodes.push(role);
  const clarify = clarifyOf(match);
  if (clarify.length) nodes.push(stateCard({icon: 'alert', tone: 'warn', title: 'Worth clarifying', text: listOf(clarify)}));
  const calls = callFacts(page?.app);
  if (calls) nodes.push(stateCard({icon: 'chat', tone: 'info', title: 'From your conversations', text: calls}));
  if (!nodes.length) nodes.push(stateCard({title: 'Not scored yet', text: 'Its facts, salary and dates are saved when the job is scored.'}));
  return nodes;
}

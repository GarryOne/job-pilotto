// Strategy page.
import {el, tile} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, message, savedAgo, show} from './core.js';
import {bone} from './focus.js';
import {openView} from './nav.js';
import {toastMessage} from './startup.js';
import {titleCase} from './strategy-review.js';

// ---------- Strategy: what you target, how matches score, what's avoided, counts, the latest insight ----------
function chips(items, tone = '') {
  const box = el('div', 'chip-list');
  box.append(...items.map(item => el('span', `chip-tag${tone ? ` tone-${tone}` : ''}`, item)));
  return box;
}
export async function loadStrategy() {
  shared.state = await window.pilot.state();
  message('strategy-message', '');
  // The last good read at once (lib/view-cache.js), then the fresh one.
  const saved = await window.pilot.cached('strategy');
  if (saved?.result?.ok && !strategyShown) {
    renderStrategy(saved.result);
    $('strategy-synced').textContent = `Saved ${savedAgo(saved.at)} · updating…`;
  } else if (!strategyShown) strategySkeleton();
  const data = await window.pilot.strategyData().catch(error => ({ok: false, error: error.message}));
  if (!data.ok) { $('strategy-view-loading')?.remove(); message('strategy-load', data.error, 'error'); return; }
  message('strategy-load', '');
  $('strategy-view-loading')?.remove();
  renderStrategy(data);
  $('strategy-synced').textContent = `Synced ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
}
let strategyShown = false;
// First load: every card in its final shape, greyed (the same rows, icons and chips), and a pill in the header.
function strategySkeleton() {
  const chipBones = n => { const box = el('div', 'chip-list'); for (let i = 0; i < n; i++) box.append(bone('chip')); return box; };
  const row = (glyph, label, value) => { const dt = el('dt'); dt.append(icon(glyph), label); const dd = el('dd'); dd.append(value); return [dt, dd]; };
  $('strategy-targets').replaceChildren(...row('briefcase', 'Roles', chipBones(3)), ...row('pin', 'Locations', chipBones(3)),
    ...row('chart', 'Compensation', bone('w-80 tall')), ...row('building', 'Company interests', chipBones(3)));
  $('strategy-scores').replaceChildren(...['settings', 'layers', 'pin', 'chart'].map(glyph => {
    const line = el('div', 'score-bar is-loading');
    line.append(icon(glyph), bone('w-name tall'), bone('w-track'), bone('w-level'));
    return line;
  }));
  $('strategy-avoid').replaceChildren(...[0, 1, 2].map(() => bone('chip wide')));
  $('strategy-glance').replaceChildren(...['file', 'layers', 'send'].map(glyph => {
    const line = el('div', 'glance-row is-loading');
    line.append(tile(glyph, 'neutral'), bone('w-count tall'), bone('w-label'), el('span', 'glance-arrow', '›'));
    return line;
  }));
  const insight = $('strategy-insight');
  insight.hidden = false;
  insight.classList.add('is-loading');
  $('strategy-insight-text').replaceChildren(bone('w-80'), bone('w-60'));
  const pill = el('span', 'loading-pill', 'Loading strategy…');
  pill.id = 'strategy-view-loading';
  $('strategy-synced').replaceChildren(pill);
}
function renderStrategy(data) {
  strategyShown = true;
  $('strategy-insight').classList.remove('is-loading');
  const row = (glyph, label, value) => {
    const dt = el('dt');
    dt.append(icon(glyph), label);
    const dd = el('dd');
    dd.append(value);
    return [dt, dd];
  };
  $('strategy-targets').replaceChildren(
    ...row('briefcase', 'Roles', chips(data.roles.slice(0, 6).map(titleCase))),
    ...row('pin', 'Locations', chips(data.locations.slice(0, 8).map(titleCase))),
    ...row('chart', 'Compensation', data.compensation || 'Not set in your Profile'),
    ...(data.stack.length ? row('layers', 'Tech stack', chips(data.stack.map(titleCase))) : []));
  const level = value => (value >= 70 ? ['High', 'good'] : value >= 50 ? ['Medium', 'warn'] : ['Low', 'bad']);
  $('strategy-score-note').textContent = !data.scored ? 'No scored matches yet: run a search with your AI key.'
    : `Average of each part of the fit score across your ${data.scored} scored matches.` +
      (data.stale ? ` Scores updating: ${data.stale} job${data.stale === 1 ? '' : 's'} wait for a new score after a Profile change (60 per search).` : '');
  show($('strategy-previous'), !!data.previous);
  if (data.previous) {
    $('strategy-previous-text').textContent = `${data.previous} score${data.previous === 1 ? ' is' : 's are'} from the previous scoring method ` +
      '(it also read your contact details and links). Kept to avoid the cost; they are re-scored when the job or your Profile changes.';
    $('strategy-rescore').textContent = `Re-score them now (≈ $${(data.previous * 0.015).toFixed(2)})`;
  }
  $('strategy-scores').replaceChildren(...data.components.map(part => {
    const [label, tone] = level(part.value);
    const line = el('div', 'score-bar');
    const track = el('span', 'score-track');
    const fill = el('span', 'score-fill');
    fill.style.width = `${part.value}%`;
    track.append(fill);
    line.append(el('span', 'score-name', part.label), track, el('span', `score-level tone-${tone}`, `${label} · ${part.value}`));
    return line;
  }));
  $('strategy-avoid').replaceChildren(...(data.avoid.length ? data.avoid : ['Nothing set']).map(item => el('span', 'chip-tag tone-bad', item)));
  const glance = (glyph, count, text, go) => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'glance-row'});
    button.append(tile(glyph, 'neutral'), el('b', '', String(count)), el('span', 'muted', text), el('span', 'glance-arrow', '›'));
    button.addEventListener('click', go);
    return button;
  };
  const jobsBy = kind => () => { openView('jobs'); if (kind) document.querySelector(`[data-stat="${kind}"]`)?.click(); };
  $('strategy-glance').replaceChildren(glance('file', data.counts.matches, 'scored matches', jobsBy('total')),
    glance('layers', data.counts.kits, 'application kits ready', jobsBy('')), glance('send', data.counts.sent, 'applications sent', jobsBy('applied')));
  show($('strategy-insight'), !!data.insight);
  if (data.insight) {
    $('strategy-insight-text').textContent = data.insight.action || data.insight.headline;
    $('strategy-insight-open').onclick = () => window.pilot.openExternal(data.insight.url);
  }
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('strategy-edit').addEventListener('click', event => window.pilot.openNotion(shared.state.notion.NOTION_SEARCH_SETTINGS_PAGE || shared.state.notion.NOTION_PROFILE_PAGE_ID, event.metaKey));
  $('strategy-jobs').addEventListener('click', () => openView('jobs'));
  $('strategy-rescore').addEventListener('click', async () => {
    $('strategy-rescore').disabled = true;
    const result = await window.pilot.rescorePrevious();
    $('strategy-rescore').disabled = false;
    toastMessage(result.ok ? 'Queued for re-scoring' : 'Not queued', result.ok ? `${result.queued} jobs get a new score over the next searches (60 per search).` : result.error);
    loadStrategy();
  });
}

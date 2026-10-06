// Strategy page: the search strategy and its coverage, read from Notion, with a link to edit it there.
import {compensationText} from '../compensation.js';
import {openInNotion} from './notion-connect.js';
import {el, tile} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, message, savedAgo, show} from './core.js';
import {bone} from './focus.js';
import {openView} from './nav.js';
import {toastMessage} from './startup.js';
import {titleCase} from './strategy-review.js';
import {coverageCard, filtersCard, placesCard, sourcesCard} from '../coverage-card.js';
import {adviceEvent} from '../coverage-actions.js';
import {openSetting} from './settings.js';

// ---------- Strategy: what you target, how matches score, what's avoided, counts, the latest insight ----------
function chips(items, tone = '') {
  const box = el('div', 'chip-list');
  box.append(...items.map(item => el('span', `chip-tag${tone ? ` tone-${tone}` : ''}`, item)));
  return box;
}
export async function loadStrategy() {
  shared.state = await window.pilot.state();
  message('strategy-message', '');
  loadCoverage({first: true});   // beside the strategy read, so the cards are there when the page first shows
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
    ...(data.level ? row('target', 'Level', chips([titleCase(data.level)])) : []),
    ...row('chart', 'Compensation', compensationText(data.compensation)),
    ...(data.stack.length ? row('layers', 'Key skills and tools', chips(data.stack.map(titleCase))) : []));
  const level = value => (value >= 70 ? ['High', 'good'] : value >= 50 ? ['Medium', 'warn'] : ['Low', 'bad']);
  $('strategy-score-note').textContent = !data.scored ? 'No scored matches yet: run a search with your AI key.'
    : `Average of each part of the fit score across your ${data.scored} scored matches.` +
      (data.stale ? ` Scores updating: ${data.stale} job${data.stale === 1 ? '' : 's'} wait for a new score after a Profile change (60 per search).` : '');
  show($('strategy-previous'), !!data.previous);
  if (data.previous) {
    $('strategy-previous-text').textContent = `${data.previous} score${data.previous === 1 ? ' is' : 's are'} kept from before your last Profile change ` +
      '(jobs that scored under 50, so they were not showing anyway). Nothing is spent re-scoring them unless you ask.';
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

// "Your search may be too narrow": read after the strategy is drawn (a quick local file), shown only when the role keywords catch little
// of the market and some role word would add real numbers. Adding a term rewrites the search settings, in the app and in Notion.
const DISMISSED = 'jp.coverage.dismissed';
const SOURCES_DISMISSED = 'jp.sources.dismissed';
const FILTERS_DISMISSED = 'jp.filters.dismissed';
const remembered = (key = DISMISSED) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
// The last verdict, kept so the cards are in place at the FIRST paint: the engine's answer takes seconds (a Python start), and a card that arrived after the page had stood still
// pushed everything down while it was being read (5 Oct 2026). With nothing kept yet, a "Checking…" card holds the place; once a visit has found no card, nothing is held.
const LAST = 'jp.coverage.last';
const lastVerdict = () => { try { const saved = JSON.parse(localStorage.getItem(LAST) || 'null'); return saved && 'verdict' in saved ? saved : null; } catch { return null; } };
const paintCoverage = verdict => {
  showCard(coverageCard(verdict, remembered()), {box: 'strategy-coverage', title: 'coverage-title', text: 'coverage-text', chips: 'coverage-chips', dismiss: 'coverage-dismiss', key: DISMISSED},
    chip => window.pilot.addRoles([chip.term]), chip => `"${chip.term}" is now a role word. The next searches look for it (also in your Search settings in Notion).`);
  showCard(placesCard(verdict, remembered(PLACES_DISMISSED)), {box: 'strategy-places', title: 'places-title', text: 'places-text', chips: 'places-chips', dismiss: 'places-dismiss', key: PLACES_DISMISSED},
    chip => window.pilot.addPlaces([chip.place]), chip => `${chip.place} is now one of your places. The next searches include it (also in your Search settings in Notion). Jobs you already have stay.`);
  // Filters of the user's own that hide matching jobs: a chip removes that filter (the same showCard as the role words).
  showCard(filtersCard(verdict, remembered(FILTERS_DISMISSED)), {box: 'strategy-filters', title: 'filters-title', text: 'filters-text', chips: 'filters-chips', dismiss: 'filters-dismiss', key: FILTERS_DISMISSED},
    chip => window.pilot.loosenSearch(chip.exclude ? {excludes: [chip.exclude]} : {languages: [chip.language]}),
    chip => chip.exclude ? `Titles with "${chip.exclude}" are no longer left out. The next searches show them (also in your Search settings in Notion).`
      : `Jobs that require ${chip.language} are no longer hidden. The next searches show them (also in your Search settings in Notion).`);
  // Unused job sources: a chip opens its panel in Settings → Connections (a key to add there), nothing is turned on from here.
  const sources = sourcesCard(verdict, remembered(SOURCES_DISMISSED));
  show($('strategy-sources'), !!sources);
  if (sources) {
    adviceEvent('shown', 'source', 'strategy');
    $('sources-title').textContent = sources.title;
    $('sources-text').textContent = sources.text;
    $('sources-chips').replaceChildren(...sources.chips.map(chip => {
      const button = Object.assign(document.createElement('button'), {type: 'button', className: 'coverage-chip', textContent: chip.label, title: chip.title});
      button.addEventListener('click', () => { adviceEvent('taken', 'source', 'strategy', {source: chip.id}); openSetting(chip.id); });
      return button;
    }));
    $('sources-dismiss').onclick = () => { adviceEvent('dismissed', 'source', 'strategy'); try { localStorage.setItem(SOURCES_DISMISSED, sources.at); } catch {} show($('strategy-sources'), false); };
  }
};
// first: called when the page starts to load, beside the strategy read (not after it).
export async function loadCoverage({first = false} = {}) {
  if (first) {
    const last = lastVerdict();
    if (last) paintCoverage(last.verdict); else show($('strategy-coverage-checking'), true);
  }
  const answer = await window.pilot.searchCoverage().catch(() => null);
  show($('strategy-coverage-checking'), false);
  const verdict = answer?.ok ? answer.coverage : null;
  if (answer?.ok) { try { localStorage.setItem(LAST, JSON.stringify({verdict})); } catch { /* the cards still show */ } }
  paintCoverage(verdict);
}
const PLACES_DISMISSED = 'jp.places.dismissed';

function showCard(card, ids, add, done, kind = ids.box.replace(/^strategy-/, '')) {
  show($(ids.box), !!card);
  if (!card) return;
  adviceEvent('shown', kind, 'strategy');
  $(ids.title).textContent = card.title;
  $(ids.text).textContent = card.text;
  $(ids.chips).replaceChildren(...card.chips.map(chip => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'coverage-chip', textContent: chip.label, title: chip.title});
    button.addEventListener('click', async () => {
      button.disabled = true;
      const result = await add(chip).catch(error => ({ok: false, error: error.message}));
      if (result.ok) adviceEvent('taken', kind, 'strategy');
      toastMessage(result.ok ? 'Search widened' : 'Not added', result.ok ? done(chip) : result.error);
      if (result.ok) loadCoverage(); else button.disabled = false;
    });
    return button;
  }));
  $(ids.dismiss).onclick = () => { adviceEvent('dismissed', kind, 'strategy'); try { localStorage.setItem(ids.key, card.at); } catch {} show($(ids.box), false); };
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('strategy-edit').addEventListener('click', event => openInNotion(shared.state.notion?.NOTION_SEARCH_SETTINGS_PAGE ? 'NOTION_SEARCH_SETTINGS_PAGE' : 'NOTION_PROFILE_PAGE_ID', event));   // busy state: openInNotion
  $('strategy-jobs').addEventListener('click', () => openView('jobs'));
  $('strategy-rescore').addEventListener('click', async () => {
    $('strategy-rescore').disabled = true;
    const result = await window.pilot.rescorePrevious();
    $('strategy-rescore').disabled = false;
    toastMessage(result.ok ? 'Queued for re-scoring' : 'Not queued', result.ok ? `${result.queued} jobs get a new score over the next searches (60 per search).` : result.error);
    loadStrategy();
  });
}

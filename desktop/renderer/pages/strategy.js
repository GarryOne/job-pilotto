// Strategy page: the search strategy and its coverage, read from Notion, with a link to edit it there.
import {withSaveProgress} from '../save-progress.js';
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
import {coverageCard, employersCard, filtersCard, placesCard, sourcesCard, visitCard} from '../coverage-card.js';
import {adviceEvent} from '../coverage-actions.js';
import {openSetting} from './settings.js';
import {startSearch} from './jobs.js';

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
    // The saved copy draws the page at once, but not its alerts about what changes: "Your Profile is empty" and "N scores kept" came back
    // for a few seconds after every refresh, from a copy older than the rebuild that cleared them (7 Oct 2026). The fresh read shows them.
    renderStrategy({...saved.result, profile_empty: false, previous: 0});
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
// ---------- What you're targeting → Edit: the lists, edited here (lib/strategy.js editLists), not in Notion ----------
// [list, icon, label, what the add field asks]: the places in their three lists, so it is clear which one "Switzerland" sits in.
export const TARGET_LISTS = [['roles', 'briefcase', 'Roles', 'Add a job title'], ['places', 'pin', 'Best places', 'Add a city or region'],
  ['country', 'pin', 'Anywhere in', 'Add a country or region'], ['abroad', 'pin', 'Places abroad', 'Add a city abroad'],
  ['stack', 'layers', 'Key skills and tools', 'Add a skill or tool']];
let lastStrategy = null, targetEdits = null;   // targetEdits: {list: {add: [words], remove: [stored fragments]}} while editing
const pendingCount = () => Object.values(targetEdits || {}).reduce((n, edit) => n + edit.add.length + edit.remove.length, 0);
// One list as it will be after Save: the stored entries not removed, then the words added.
export function editedList(entries, edit = {add: [], remove: []}) {
  const gone = new Set(edit.remove);
  return [...entries.filter(entry => !gone.has(entry.fragment)).map(entry => ({...entry, added: false})),
    ...edit.add.map(word => ({fragment: '', label: word, added: true}))];
}
function editableRow(name, glyph, label, placeholder) {
  const edit = targetEdits[name] ||= {add: [], remove: []};
  const dt = el('dt'); dt.append(icon(glyph), label);
  const dd = el('dd');
  const box = el('div', 'chips');
  box.append(...editedList(lastStrategy.lists?.[name] || [], edit).map(entry => {
    const pill = el('span', `chip removable${entry.added ? ' is-added' : ''}`);
    const remove = Object.assign(document.createElement('button'), {type: 'button', className: 'x', textContent: '×', title: `Remove ${entry.label}`});
    remove.setAttribute('aria-label', `Remove ${entry.label}`);
    remove.addEventListener('click', () => {
      if (entry.added) edit.add = edit.add.filter(word => word !== entry.label); else edit.remove.push(entry.fragment);
      renderTargets();
    });
    pill.append(el('span', '', titleCase(entry.label)), remove);
    return pill;
  }));
  const input = Object.assign(document.createElement('input'), {className: 'add', placeholder: `${placeholder}, then Enter`});
  input.dataset.list = name;
  input.addEventListener('keydown', event => {
    const word = input.value.trim().toLowerCase();
    if (event.key !== 'Enter' || !word) return;
    const back = (lastStrategy.lists?.[name] || []).find(entry => edit.remove.includes(entry.fragment) && entry.label.toLowerCase() === word);
    if (back) edit.remove = edit.remove.filter(fragment => fragment !== back.fragment);   // removed, then typed again: kept
    else if (!edit.add.includes(word) && !(lastStrategy.lists?.[name] || []).some(entry => entry.label.toLowerCase() === word)) edit.add.push(word);
    renderTargets();
    document.querySelector(`#strategy-targets input.add[data-list="${name}"]`)?.focus();
  });
  box.append(input);
  dd.append(box);
  return [dt, dd];
}
function renderTargets() {
  const editing = !!targetEdits;
  $('strategy-targets').classList.toggle('is-editing', editing);
  show($('targets-actions'), editing);
  $('open-profile').hidden = editing;
  if (!editing) { renderStrategy(lastStrategy); return; }
  $('strategy-targets').replaceChildren(...TARGET_LISTS.flatMap(([name, glyph, label, placeholder]) => editableRow(name, glyph, label, placeholder)));
  $('targets-save').disabled = !pendingCount();
}
function startTargetsEdit() {
  if (!lastStrategy?.lists) return;
  targetEdits = {};
  message('targets-message', '');
  renderTargets();
}
async function saveTargets() {
  const button = $('targets-save');
  button.disabled = true; button.textContent = 'Saving…';
  // A word typed but not yet added with Enter still counts: people press Save straight after typing.
  document.querySelectorAll('#strategy-targets input.add').forEach(input => {
    const word = input.value.trim().toLowerCase(), edit = targetEdits[input.dataset.list];
    if (word && !edit.add.includes(word)) edit.add.push(word);
  });
  const result = await withSaveProgress(words => { button.textContent = words; }, () => window.pilot.editTargets(targetEdits)).catch(error => ({ok: false, error: error.message}));
  button.textContent = 'Save';
  if (!result.ok) { message('targets-message', result.error || 'Not saved.', 'error'); button.disabled = false; return; }
  targetEdits = null;
  toastMessage('Strategy saved ✓', 'The next search uses it.');
  await loadStrategy();
  renderTargets();
}

function renderStrategy(data) {
  strategyShown = true;
  lastStrategy = data;
  show($('strategy-profile-empty'), !!data.profile_empty);   // scores are paused until it is filled (src/ai/score.py unfilled)
  if (targetEdits) { renderTargets(); return; }   // a fresh read while editing keeps the edits on screen
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
const FORYOU_DISMISSED = 'jp.foryou.dismissed';
const VISITS_DISMISSED = 'jp.visits.dismissed';
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
  // Sites only you can open: a chip opens the page in the browser that has the extension, where "Read the jobs on this page" reads it.
  const visitsCard = visitCard(verdict, remembered(VISITS_DISMISSED));
  show($('strategy-visits'), !!visitsCard);
  if (visitsCard) {
    adviceEvent('shown', 'visit', 'strategy');
    $('visits-title').textContent = visitsCard.title;
    $('visits-text').textContent = visitsCard.text;
    $('visits-chips').replaceChildren(...visitsCard.chips.map(chip => {
      const button = Object.assign(document.createElement('button'), {type: 'button', className: 'coverage-chip', textContent: chip.label, title: chip.title});
      button.addEventListener('click', async () => {
        adviceEvent('taken', 'visit', 'strategy');
        const opened = await window.pilot.openVisit(chip.url).catch(error => ({ok: false, error: error.message}));
        toastMessage(opened.ok ? 'Opened in Chrome' : 'Not opened', opened.ok ? `Click the Job Pilotto icon there, then "Read the jobs on this page".${chip.note ? ` ${chip.note}.` : ''}` : opened.error);
      });
      return button;
    }));
    $('visits-dismiss').onclick = () => { adviceEvent('dismissed', 'visit', 'strategy'); try { localStorage.setItem(VISITS_DISMISSED, visitsCard.at); } catch {} show($('strategy-visits'), false); };
  }
  // Employers where people like you got interviews (shared pool): a chip shows that employer's jobs in the Jobs list.
  const forYou = employersCard(verdict, remembered(FORYOU_DISMISSED));
  show($('strategy-foryou'), !!forYou);
  if (forYou) {
    adviceEvent('shown', 'employer', 'strategy');
    $('foryou-title').textContent = forYou.title;
    $('foryou-text').textContent = forYou.text;
    $('foryou-chips').replaceChildren(...forYou.chips.map(chip => {
      const button = Object.assign(document.createElement('button'), {type: 'button', className: 'coverage-chip', textContent: chip.label, title: chip.title});
      button.addEventListener('click', () => {
        adviceEvent('taken', 'employer', 'strategy');
        openView('jobs');
        const box = $('filter-text');
        if (box) { box.value = chip.company; box.dispatchEvent(new Event('input', {bubbles: true})); }
      });
      return button;
    }));
    $('foryou-dismiss').onclick = () => { adviceEvent('dismissed', 'employer', 'strategy'); try { localStorage.setItem(FORYOU_DISMISSED, forYou.at); } catch {} show($('strategy-foryou'), false); };
  }
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
      const result = await withSaveProgress(words => { button.textContent = `${chip.label} · ${words}`; }, () => add(chip)).catch(error => ({ok: false, error: error.message}));
      button.textContent = chip.label;
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
  // A page read through the extension (Sites only you can open): said wherever the window is, once per page.
  // Few new jobs twice in a row (lib/few-jobs.js): a dot on Strategy until it is opened.
  window.pilot.onFewJobs?.(() => show($('strategy-dot'), true));
  document.querySelector('.nav[data-view=strategy]')?.addEventListener('click', () => show($('strategy-dot'), false));
  window.pilot.onVisitRead?.(answer => toastMessage(answer.fits === undefined ? `Read ${answer.jobs} jobs from ${answer.name}` : `Read ${answer.jobs} jobs from ${answer.name}, ${answer.fits} matching your search`,
    answer.fits ? 'Your next jobs check scores the matching ones: those that fit your profile join your Jobs list.' : 'The reading works; none of these match your role words and places, so your Jobs list stays the same.'));
  $('open-profile').addEventListener('click', startTargetsEdit);
  $('profile-empty-rebuild').addEventListener('click', () => $('strategy-redo').click());   // the same Rebuild from CV as the Profile page
  $('targets-cancel').addEventListener('click', () => { targetEdits = null; message('targets-message', ''); renderTargets(); });
  $('targets-save').addEventListener('click', saveTargets);
  $('strategy-edit').addEventListener('click', event => openInNotion(shared.state.notion?.NOTION_SEARCH_SETTINGS_PAGE ? 'NOTION_SEARCH_SETTINGS_PAGE' : 'NOTION_PROFILE_PAGE_ID', event));   // busy state: openInNotion
  $('strategy-jobs').addEventListener('click', () => openView('jobs'));
  // Re-score them now: the kept scores are queued, then a search starts at once and scores them (60 per search), shown like any search
  // (header status, Recent activity, its result). 7 Oct 2026: it only queued them for later searches, so nothing seemed to happen.
  $('strategy-rescore').addEventListener('click', async () => {
    const button = $('strategy-rescore'), label = button.textContent;
    button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Re-scoring…';
    try {
      const result = await window.pilot.rescorePrevious();
      if (!result.ok) { toastMessage('Not re-scored', result.error); return; }
      toastMessage('Re-scoring now', `${result.queued} jobs get a new score in this search${result.queued > 60 ? ' (60 now, the rest in the next one)' : ''}. Follow it in Recent activity.`);
      await startSearch();
    } finally {
      button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label;
      loadStrategy();
    }
  });
}

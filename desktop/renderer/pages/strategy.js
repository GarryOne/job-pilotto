// Strategy page: the search strategy and its coverage, read from Notion, with a link to edit it there.
import {withSaveProgress} from '../save-progress.js';
import {openInNotion} from './notion-connect.js';
import {el, moreButton, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, message, savedAgo, show} from './core.js';
import {bone} from './focus.js';
import {guardLeave, openView} from './nav.js';
import {toastMessage} from './startup.js';
import {titleCase} from './strategy-review.js';
import {goalTiles} from '../goal-tiles.js';
import {showSearchChanged, wireSearchChanged} from '../search-changed.js';
import {coverageCard, employersCard, filtersCard, ideasCard, placesCard, sourcesCard, visitCard} from '../coverage-card.js';
import {adviceEvent} from '../coverage-actions.js';
import {byOpenings, dirtyLists, exclusionGroups, hostOf, roleFamilies, sitesByName, withTyped} from '../strategy-parts.js';
import {openSetting} from './settings.js';
import {startSearch} from './jobs.js';

// ---------- Strategy: what you target, how matches score, what's avoided, counts, the latest insight ----------
export async function loadStrategy() {
  shared.state = await window.pilot.state();
  message('strategy-message', '');
  pendingImprove.add('previous');   // the older scores come with the fresh read only (the saved copy leaves them out)
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
  if (!data.ok) { pendingImprove.delete('previous'); drawImprove(); $('strategy-view-loading')?.remove(); message('strategy-load', data.error, 'error'); return; }
  message('strategy-load', '');
  $('strategy-view-loading')?.remove();
  pendingImprove.delete('previous');
  renderStrategy(data);
  $('strategy-synced').textContent = `Synced ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
}
let strategyShown = false;
// First load: every card in its final shape, greyed (the same rows, icons and chips), and a pill in the header.
function strategySkeleton() {
  const chipBones = n => { const box = el('div', 'chip-list'); for (let i = 0; i < n; i++) box.append(bone('chip')); return box; };
  // The target cards themselves (TARGET_CARDS: head, then each list's label and chips), greyed. 7 Oct 2026: the old Roles/Locations rows,
  // left from before the cards, fell into the cards' grid as loose lines.
  $('strategy-targets').replaceChildren(...inColumns(TARGET_CARDS.map(([key, glyph, title, lists]) => {
    const card = el('section', 'card is-loading'), head = el('div', 'card-head'), heading = el('h3');
    card.dataset.list = key;
    heading.append(tile(glyph, CARD_TONE[key] || 'neutral'), title);
    head.append(heading);
    card.append(head);
    for (const [name, label] of lists) {
      if (name === 'places') { const priority = el('div', 'priority'); priority.append(el('b', '', label), chipBones(2)); card.append(priority); continue; }
      if (label) card.append(el('p', 'sub', label));
      card.append(chipBones(lists.length > 1 ? 2 : 3));
    }
    return card;
  })));
  $('strategy-scores').replaceChildren(...['settings', 'layers', 'pin', 'chart'].map(glyph => {
    const line = el('div', 'score-bar is-loading');
    line.append(icon(glyph), bone('w-name tall'), bone('w-track'), bone('w-level'));
    return line;
  }));
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
// ---------- Your goals and the setup review's cards, with your live settings (owner, 7 Oct 2026: the page lacked work mode, salary,
// languages, search terms, excluded languages and work rights, which the setup review shows). Lists: Edit → Save (lib/strategy.js editLists,
// to ⚙️ Search settings); goals: corrected one at a time in the Profile (lib/goals.js), like the review.
// [card, icon, title, its lists: [list, label or note, what the add field asks]]
// Owner mockup, 7 Oct 2026: four cards (roles with their search terms, places with eligibility, skills, exclusions); every list still edits here.
const CARD_TONE = {roles: 'violet', places: 'teal', stack: 'info', languages: 'warn'};   // the same colours as the suggestions of each kind
export const TARGET_CARDS = [
  ['roles', 'briefcase', 'Roles & job board searches', [['roles', '', 'Add a job title'], ['queries', 'Job board searches: what we type into job boards such as jobs.ch', 'Add a job board search']]],
  ['places', 'pin', 'Locations & eligibility', [['places', 'Priority locations', 'Add a city or region'], ['country', 'Additional regions', 'Add a country or region'],
    ['abroad', 'Relocation (open to)', 'Add a city abroad'], ['rights', 'Work rights: where you can work without a visa', 'Add a country or EU']]],
  ['stack', 'layers', 'Skills & experience', [['stack', 'Key skills and tools you want in jobs.', 'Add a skill or tool']]],
  ['languages', 'shield', 'Exclusions & preferences', [['languages', 'Languages that rule a job out', 'Add a language']]],
];
export const TARGET_LISTS = TARGET_CARDS.flatMap(([, , , lists]) => lists.map(([name]) => name));
let lastStrategy = null, targetEdits = null;   // targetEdits: {list: {add: [words], remove: [stored entries]}, remote: {set}} while editing
let typed = {};   // the text still in each list's input (not yet added with Enter): part of the draft
const dirty = () => dirtyLists(targetEdits, typed);
// Two columns that stack on their own (owner, 7 Oct 2026: cards sharing a grid row left tall gaps under the shorter one when zoomed out).
const COLUMNS = [['roles', 'stack'], ['places', 'languages']];
const inColumns = cards => COLUMNS.map(keys => {
  const column = el('div', 'target-column');
  column.append(...keys.map(key => cards.find(card => card.dataset.list === key)).filter(Boolean));
  return column;
});
// A list's entries as stored ({fragment, label}): the match lists come as both, the plain ones (search phrases, languages) as written.
const entriesOf = (data, name) => data?.lists?.[name] || (data?.texts?.[name] || []).map(text => ({fragment: text, label: text}));
// One list as it will be after Save: the stored entries not removed, then the words added.
export function editedList(entries, edit = {add: [], remove: []}) {
  const gone = new Set(edit.remove);
  return [...entries.filter(entry => !gone.has(entry.fragment)).map(entry => ({...entry, added: false})),
    ...edit.add.map(word => ({fragment: '', label: word, added: true}))];
}
const PLAIN = new Set(['queries', 'languages']);   // stored as typed, not lower-cased
function listChips(name, placeholder) {
  const editing = !!targetEdits, edit = editing ? (targetEdits[name] ||= {add: [], remove: []}) : null;
  const stored = entriesOf(lastStrategy, name);
  const box = el('div', 'chips');
  const entries = editing ? editedList(stored, edit) : stored;
  box.append(...entries.map(entry => {
    const pill = el('span', `chip${editing ? ' removable' : ''}${entry.added ? ' is-added' : ''}`);
    pill.append(el('span', '', titleCase(entry.label)));
    if (editing) {
      const remove = Object.assign(document.createElement('button'), {type: 'button', className: 'x', textContent: '×', title: `Remove ${entry.label}`});
      remove.setAttribute('aria-label', `Remove ${entry.label}`);
      remove.addEventListener('click', () => {
        if (entry.added) edit.add = edit.add.filter(word => word !== entry.label); else edit.remove.push(entry.fragment);
        renderTargets();
      });
      pill.append(remove);
    }
    return pill;
  }));
  if (!entries.length && !editing) box.append(el('span', 'muted small', 'None'));
  if (editing) {
    const input = Object.assign(document.createElement('input'), {className: 'add', placeholder: `${placeholder}, then Enter`, value: typed[name] || ''});
    input.dataset.list = name;
    input.addEventListener('input', () => { typed[name] = input.value; refreshDraft(); });
    input.addEventListener('keydown', event => {
      const typed = input.value.trim(), word = PLAIN.has(name) ? typed : typed.toLowerCase();
      if (event.key !== 'Enter' || !word) return;
      const same = entry => entry.label.toLowerCase() === word.toLowerCase();
      const back = stored.find(entry => edit.remove.includes(entry.fragment) && same(entry));
      if (back) edit.remove = edit.remove.filter(fragment => fragment !== back.fragment);   // removed, then typed again: kept
      else if (!edit.add.some(added => added.toLowerCase() === word.toLowerCase()) && !stored.some(same)) edit.add.push(word);
      event.preventDefault();   // Enter adds a chip; it never saves the strategy
      delete typed[name];
      renderTargets();
      document.querySelector(`#strategy-targets input.add[data-list="${name}"]`)?.focus();
    });
    box.append(input);
  }
  return box;
}
// Remote jobs (Search settings "Remote jobs"): a place of its own, or only jobs in your places.
function remoteChoice() {
  const now = lastStrategy?.remote_jobs !== false, chosen = targetEdits?.remote ? targetEdits.remote.set === 'Yes' : now;
  if (!targetEdits) return el('span', '', now ? 'Anywhere: remote jobs count as one of your places' : 'Only those based in your locations');
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Remote jobs');
  for (const [label, yes] of [['Yes', true], ['No', false]]) {
    const button = el('button', yes === chosen ? 'is-active' : '', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(yes === chosen));
    button.addEventListener('click', () => {
      if (yes === now) delete targetEdits.remote; else targetEdits.remote = {set: label};
      renderTargets();
    });
    group.append(button);
  }
  return group;
}
function targetCard([key, glyph, title, lists]) {
  const card = el('section', 'card');
  card.dataset.list = key;
  const head = el('div', 'card-head'), heading = el('h3');
  heading.append(tile(glyph, CARD_TONE[key] || 'neutral'), title);
  const badge = pill('Edited', 'warn');
  badge.classList.add('edited-badge');
  badge.hidden = !lists.some(([name]) => dirty().has(name)) && !(key === 'places' && dirty().has('remote'));
  heading.append(badge);
  head.append(heading);
  if (!targetEdits) {
    const edit = el('button', 'link with-icon card-edit', icon('edit'));
    edit.append(el('span', '', 'Edit'));
    Object.assign(edit, {type: 'button', title: `Edit ${title.toLowerCase()}`});
    edit.setAttribute('aria-label', edit.title);
    edit.addEventListener('click', startTargetsEdit);
    head.append(edit);
  }
  card.append(head);
  if (!targetEdits) { card.append(...VIEWS[key]()); return card; }
  for (const [name, label, placeholder] of lists) {
    const box = listChips(name, placeholder);
    if (name === 'places') { const priority = el('div', 'priority'); priority.append(el('b', '', label), box); card.append(priority); continue; }
    if (label) card.append(el('p', 'sub', label));
    card.append(box);
  }
  if (key === 'places') card.append(el('p', 'sub', 'Remote jobs'), remoteChoice());
  return card;
}
// ---------- The cards as read (not editing): grouped and short; Edit shows every list in full as before ----------
const chipsOf = (labels, cased = true) => {
  const box = el('div', 'chips');
  box.append(...labels.map(label => el('span', 'chip', cased ? titleCase(label) : label)));
  return box;
};
// A few chips, the rest behind a toggle ("View title variants", "Show all"): nothing is dropped, only folded.
function folded(labels, keep, more) {
  const box = chipsOf(labels.slice(0, keep));
  if (labels.length <= keep) return box;
  const rest = labels.slice(keep), toggle = el('button', 'link chip-more', `${more} (${rest.length})`);
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => { toggle.replaceWith(...rest.map(label => el('span', 'chip', titleCase(label)))); });
  box.append(toggle);
  return box;
}
// One labelled row: an icon, a label, then its value (words or chips).
function settingRow(glyph, label, value) {
  const row = el('div', 'setting-row'), words = el('div', 'setting-body');
  words.append(el('b', '', label), typeof value === 'string' ? el('span', 'muted', value) : value);
  row.append(icon(glyph), words);
  return row;
}
const labelsOf = name => entriesOf(lastStrategy, name).map(entry => entry.label);
// What is typed into the job boards, apart from the roles that decide a match (owner, 7 Oct 2026: a magnifier row read as a search box, with no
// word of what it is for). A labelled row like the families, and one line on what it does.
function boardSearches(queries) {
  const row = el('div', 'family-row'), body = el('div', 'setting-body');
  body.append(queries.length ? folded(queries, 6, 'Show all') : el('span', 'muted', 'None: your roles are searched as they are'),
    el('span', 'muted small', 'What we type into job boards such as jobs.ch. Your roles above decide which job titles count as a match.'));
  row.append(el('b', '', 'Job board searches'), body);
  return row;
}
const VIEWS = {
  roles() {
    // Families from the engine (src/role_kinds.py): Retail, Logistics…; spellings and translations fold under "View title variants".
    const families = roleFamilies(entriesOf(lastStrategy, 'roles')).map(family => {
      const row = el('div', 'family-row');
      row.append(el('b', '', family.label), folded(family.entries.map(entry => entry.label), 2, 'View title variants'));
      return row;
    });
    const queries = labelsOf('queries');
    return [el('p', 'sub', 'Roles you search for, grouped by family.'),
      ...(families.length ? families : [el('span', 'muted small', 'No roles yet: Edit to add one.')]),
      boardSearches(queries)];
  },
  places() {
    const priority = el('div', 'priority');
    const places = labelsOf('places');
    priority.append(el('b', '', 'Priority locations'), places.length ? chipsOf(places) : el('span', 'muted small', 'None'));
    const regions = labelsOf('country'), abroad = labelsOf('abroad'), rights = labelsOf('rights');
    return [priority,
      settingRow('globe', 'Additional regions', regions.length ? folded(regions, 4, 'Show all') : 'None selected'),
      settingRow('send', 'Relocation', abroad.length ? chipsOf(abroad) : 'Not enabled'),
      settingRow('building', 'Remote jobs', remoteChoice()),
      settingRow('shield', 'Work rights', rights.length ? chipsOf(rights) : 'Not set: jobs abroad are flagged "visa sponsorship needed"'),
      // The goal "Work mode" (what you accept) and this (where remote jobs are searched) read as a contradiction side by side (owner, 7 Oct 2026).
      el('p', 'muted small card-foot', 'Work mode (in Goals) is the kind of job you accept; Remote jobs is where the search looks for them.')];
  },
  stack() {
    const stack = labelsOf('stack');
    return [el('p', 'sub', 'Key skills and tools you want in jobs.'), stack.length ? folded(stack, 10, 'Show all') : el('span', 'muted small', 'None')];
  },
  languages() {
    const {languages, hide, lower} = exclusionGroups(lastStrategy);
    const block = el('div', 'setting-body');
    block.append(languages.length ? chipsOf(languages) : el('span', 'muted', 'None'),
      el('span', 'muted small', 'A job that requires one is hidden; one that only prefers it ranks lower.'));
    // Warning colour only for a consequence: the last coverage check counted matching jobs these languages hid (src/coverage.py).
    const listed = new Set(languages.map(language => language.toLowerCase()));
    const hidden = (shownVerdict?.languages || []).filter(item => listed.has(String(item.language).toLowerCase())).reduce((sum, item) => sum + (item.count || 0), 0);
    if (hidden) {
      const warn = el('p', 'tone-warn exclusion-warn', icon('alert'));
      warn.append(`Hides ${hidden.toLocaleString('en-US')} job${hidden === 1 ? '' : 's'} that match your roles and places (see Suggestions).`);
      block.append(warn);
    }
    const rules = el('div', 'setting-row'), title = el('div', 'setting-body');
    title.append(el('b', '', 'Excluded language requirements'), block);
    rules.append(icon('globe'), title);
    const more = el('details', 'plain exclusion-more'), summary = el('summary');
    summary.append(icon('sliders'), el('span', '', 'Other exclusions and ranking rules'),
      el('span', 'muted small', `${hide.length} hide jobs · ${lower.length} rank${lower.length === 1 ? 's' : ''} lower`));
    more.append(summary,
      el('p', 'sub', 'Hide matching jobs'), hide.length ? chipsOf(hide.map(item => item.label), false) : el('span', 'muted small', 'None'),
      el('p', 'sub', 'Rank them lower'), lower.length ? chipsOf(lower.map(item => item.label), false) : el('span', 'muted small', 'None'));
    return [rules, more];
  },
};
// Your goals: a correction goes straight into the Profile; the fit scores follow it over the next searches.
async function saveGoal(key, text, value) {
  value.textContent = 'Saving…';
  const result = await window.pilot.editGoal(key, text).catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { toastMessage('Goal not saved', result.error || 'Try again.'); value.textContent = lastStrategy?.goals?.[key] || '—'; return; }
  toastMessage('Goal saved ✓', 'It is in your Profile now. Your jobs are re-scored with it over the next searches.');
  lastStrategy = {...lastStrategy, goals: {...lastStrategy.goals, [key]: text}};
  renderGoals();
}
function renderGoals() {
  // A Profile written before the goals rows: its Compensation line and the search's level stand in until a goal is corrected.
  const goals = lastStrategy?.goals && {...lastStrategy.goals, minimum_salary: lastStrategy.goals.minimum_salary || lastStrategy.compensation || '',
    seniority: lastStrategy.goals.seniority || (lastStrategy.level ? titleCase(lastStrategy.level) : '')};
  $('strategy-goals').replaceChildren(...goalTiles(goals || {}, goals ? saveGoal : null));
}
function renderTargets() {
  const editing = !!targetEdits;
  $('strategy-live').classList.toggle('is-editing', editing);
  $('strategy-targets').replaceChildren(...inColumns(TARGET_CARDS.map(targetCard)));
  refreshDraft();
}
// The save bar and the Edited badges, from the draft (typing redraws only these, so the input keeps its focus).
let saving = false;
function refreshDraft() {
  const changed = dirty();
  show($('strategy-savebar'), !!targetEdits);
  if (!targetEdits) return;
  $('savebar-title').textContent = changed.size ? 'Unsaved strategy changes' : 'Editing your strategy';
  $('savebar-sub').textContent = changed.size ? 'Applies to future searches.' : 'Add or remove what you want, then save.';
  $('targets-save').disabled = saving || !changed.size;
  $('targets-cancel').disabled = saving;
  $('targets-cancel').textContent = changed.size ? 'Discard changes' : 'Done';
  for (const card of document.querySelectorAll('#strategy-targets .card[data-list]')) {
    const [key, , , lists] = TARGET_CARDS.find(([name]) => name === card.dataset.list);
    const badge = card.querySelector('.edited-badge');
    if (badge) badge.hidden = !lists.some(([name]) => changed.has(name)) && !(key === 'places' && changed.has('remote'));
  }
}
function startTargetsEdit() {
  if (!lastStrategy?.lists) return;
  targetEdits ||= {};
  message('targets-message', '');
  renderTargets();
}
function discardTargets() {
  targetEdits = null;
  typed = {};
  message('targets-message', '');
  renderTargets();
}
// One save for the whole draft, words still typed included. On failure the draft stays, with Retry; "Synced to Notion" only once it is.
async function saveTargets() {
  if (saving || !targetEdits) return false;
  const edits = withTyped(targetEdits, typed, PLAIN, name => entriesOf(lastStrategy, name));
  const tooLong = Object.values(edits).flatMap(edit => edit.add || []).find(word => word.length > 80);
  if (tooLong) { message('targets-message', `"${tooLong.slice(0, 30)}…" is too long for one entry (80 characters at most).`, 'error'); return false; }
  const button = $('targets-save');
  saving = true;
  refreshDraft();
  message('targets-message', '');
  const result = await withSaveProgress(words => { button.textContent = words; }, () => window.pilot.editTargets(edits)).catch(error => ({ok: false, error: error.message}));
  saving = false;
  button.textContent = 'Save changes';
  if (!result.ok) {
    message('targets-message', `Couldn't save: ${result.error || 'try again'}`, 'error');
    button.textContent = 'Retry';
    refreshDraft();
    return false;
  }
  targetEdits = null;
  typed = {};
  // Saved to Search settings; when Notion is connected, editLists has published it there before answering ok (lib/strategy.js).
  toastMessage({title: 'Strategy saved ✓', body: `${shared.state?.notionConnected ? 'Synced to Notion. ' : ''}Refresh your jobs to search with it.`, action: refreshAction});
  await loadStrategy();
  renderTargets();
  return true;
}

function renderStrategy(data) {
  strategyShown = true;
  lastStrategy = data;
  show($('strategy-profile-empty'), !!data.profile_empty);
  wireSearchChanged();
  showSearchChanged(shared.state?.settings);   // scores are paused until it is filled (src/ai/score.py unfilled)
  if (targetEdits) { renderTargets(); drawImprove(); return; }   // a fresh read while editing keeps the edits on screen
  $('strategy-insight').classList.remove('is-loading');
  renderGoals();
  renderTargets();
  const level = value => (value >= 70 ? 'good' : value >= 50 ? 'warn' : 'bad');
  // Averages of what the matches scored, not the weights of the score (owner, 7 Oct 2026: "How matches are scored" read as weights).
  $('strategy-score-note').textContent = !data.scored ? 'No scored matches yet: run a search with your AI key.'
    : `Across your ${data.scored} scored match${data.scored === 1 ? '' : 'es'} · Averages, not scoring weights.`;
  // Two different groups: "stale" jobs are queued and get a new score over the next searches; "previous" ones are kept and never queued
  // unless you ask (src/ai/score.py).
  show($('strategy-stale'), !!data.stale);
  $('strategy-stale-text').textContent = data.stale ? `${data.stale} job${data.stale === 1 ? '' : 's'} queued for a new score after your Profile change · up to 60 per search` : '';
  drawImprove();   // its "older scores" row
  $('strategy-scores').replaceChildren(...data.components.map(part => {
    const line = el('div', 'score-bar');
    const track = el('span', 'score-track');
    const fill = el('span', 'score-fill');
    fill.style.width = `${part.value}%`;
    track.append(fill);
    line.append(el('span', 'score-name', part.label), track, el('span', `score-level tone-${level(part.value)}`, `${part.value} / 100`));
    return line;
  }));
  const glance = (glyph, count, text, go, tone = 'neutral') => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'glance-row'});
    button.append(tile(glyph, tone), el('b', '', String(count)), el('span', 'muted', text), el('span', 'glance-arrow', '›'));
    button.addEventListener('click', go);
    return button;
  };
  const jobsBy = kind => () => { openView('jobs'); if (kind) document.querySelector(`[data-stat="${kind}"]`)?.click(); };
  $('strategy-glance').replaceChildren(glance('file', data.counts.matches, 'scored matches', jobsBy('total'), 'info'),
    glance('layers', data.counts.kits, 'application kits ready', jobsBy(''), 'violet'), glance('send', data.counts.sent, 'applications sent', jobsBy('applied'), 'signal'));
  show($('strategy-insight'), !!data.insight);
  if (data.insight) {
    $('strategy-insight-text').textContent = data.insight.action || data.insight.headline;
    $('strategy-insight-open').onclick = () => window.pilot.openExternal(data.insight.url);
  }
}

// ---------- Suggestions: one row per kind (owner mockup, 7 Oct 2026: five banners pushed your own settings below the fold) ----------
// The engine's coverage verdict (src/coverage.py, read after the strategy: a Python start) and the roles from your Profile (src/ai/role_ideas.py)
// give the rows; each row says what it is in a line, Review opens what would change (one button per option), ⋯ hides it.
const DISMISSED = 'jp.coverage.dismissed';
const SOURCES_DISMISSED = 'jp.sources.dismissed';
const FILTERS_DISMISSED = 'jp.filters.dismissed';
const FORYOU_DISMISSED = 'jp.foryou.dismissed';
const VISITS_DISMISSED = 'jp.visits.dismissed';
const PLACES_DISMISSED = 'jp.places.dismissed';
const remembered = (key = DISMISSED) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
// The last verdict, kept so the rows are in place at the FIRST paint: the engine's answer takes seconds, and a card that arrived after the page had
// stood still pushed everything down while it was being read (5 Oct 2026). With nothing kept yet, a "Checking…" row holds the place.
const LAST = 'jp.coverage.last';
const lastVerdict = () => { try { const saved = JSON.parse(localStorage.getItem(LAST) || 'null'); return saved && 'verdict' in saved ? saved : null; } catch { return null; } };
let shownVerdict = null, checking = false;
const rows = {};   // kind → the row's element, or null when it has nothing to say
const ORDER = ['places', 'ideas', 'coverage', 'filters', 'sources', 'visits', 'foryou'];
const plain = label => label.replace(/^[+−] /, '');
const number = value => Number(value || 0).toLocaleString('en-US');

// Review from elsewhere (Recent activity's "Review location"): Strategy opens with that row's options showing. Kept until the row is drawn.
let pendingReview = '';
const openRows = new Set();   // rows whose options are showing: the rows are drawn again when the fresh verdict lands, and stay open
export function reviewSuggestion(id) {
  pendingReview = id;
  if (document.querySelector('.view[data-view=strategy]')?.hidden) openView('strategy');
  showTab('strategy-suggestions');
  openPending();
}
function openPending() {
  const row = pendingReview && rows[pendingReview];
  if (!row?.isConnected) return;
  const toggle = row.querySelector('[data-review]');
  if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
  row.scrollIntoView({block: 'center'});
  pendingReview = '';
}
function drawSuggestions() {
  const list = ORDER.map(kind => rows[kind]).filter(Boolean);
  const box = $('suggestion-rows');
  if (checking) {
    const row = el('section', 'suggestion-card is-loading'), head = el('div', 'suggestion-head'), words = el('div', 'suggestion-words');
    row.id = 'strategy-coverage-checking';
    row.setAttribute('aria-busy', 'true');
    words.append(el('h3', '', 'Checking whether your search is too narrow…'), el('span', 'muted', 'Reading the postings your searches saw.'));
    head.append(tile('target', 'neutral'), words);
    row.append(head);
    list.push(row);
  }
  box.replaceChildren(...(list.length ? list : [el('p', 'card muted empty-row', 'No suggestions right now: your search already catches what the last check saw.')]));
  const count = ORDER.filter(kind => rows[kind]).length;
  $('suggestions-count').textContent = String(count);
  show($('suggestions-count'), count > 0);
  drawImprove();
  openPending();
}
// ---------- Improve your search: one compact row per kind, above the tabs (owner, 7 Oct 2026: the banners' actions were easy to miss in a tab) ----------
// Neutral rows; the action opens that kind's detail in Suggestions (or the re-score's cost). briefs: what each row says, set as its row is built.
const briefs = {};
// Placeholders for the rows still on their way (owner, 7 Oct 2026: "these banners add up after 5-10 seconds"): the older scores come with the fresh
// strategy read only, and the role ideas when nothing is kept yet. A placeholder stands only where that row was last time (or on a first visit),
// so the panel keeps its height and a row that turns out empty does not flash in and out.
const pendingImprove = new Set();
const SEEN = 'jp.improve.seen';   // the rows the panel had last time it was complete
const seenRows = () => { try { return JSON.parse(localStorage.getItem(SEEN) || 'null'); } catch { return null; } };
const placeholderRow = () => {
  const line = el('li', 'improve-placeholder');
  line.setAttribute('aria-busy', 'true');
  line.append(bone('tile'), bone('w-name tall'), bone('w-60'), bone('button small'));
  return line;
};
function drawImprove() {
  const items = [];
  const seen = seenRows();
  let guesses = 3;   // a first visit with nothing kept: a few placeholders, not one per kind
  const expected = id => (seen ? seen.includes(id) : id === 'previous' || id === 'ideas' || guesses-- > 0);
  const previous = lastStrategy?.previous || 0;
  if (!previous && pendingImprove.has('previous') && expected('previous')) items.push(placeholderRow());
  if (previous) {
    const cost = `≈ $${(previous * 0.015).toFixed(2)}`;
    // Off from the click until its refresh has ended (owner, 7 Oct 2026: a second click looked like a second re-score).
    const go = el('button', 'secondary item-action', rescoring ? 'Re-scoring…' : `Re-score · ${cost}`);
    go.type = 'button';
    go.disabled = rescoring;
    if (rescoring) go.title = 'Running in Refresh jobs: follow it in Recent activity';
    go.addEventListener('click', () => confirmRescore(previous, cost));
    items.push(improveRow('refresh', 'info', `${previous} job${previous === 1 ? ' has an older score' : 's have older scores'}`,
      'Below 50 before your Profile changed · Updating is optional', go));
  }
  for (const id of ORDER) {
    const brief = rows[id] && briefs[id];
    const waiting = id === 'ideas' ? pendingImprove.has('ideas') : checking;
    if (!brief && waiting && expected(id)) { items.push(placeholderRow()); continue; }
    if (!brief) continue;
    const go = el('button', 'secondary item-action', brief.cta);
    go.type = 'button';
    go.addEventListener('click', () => reviewSuggestion(id));
    items.push(improveRow(brief.glyph, TONE[id] || 'neutral', brief.title, brief.text, go));
  }
  $('improve-rows').replaceChildren(...items);
  show($('strategy-improve'), items.length > 0);
  if (!pendingImprove.size && !checking) {
    const drawn = [...(previous ? ['previous'] : []), ...ORDER.filter(id => rows[id] && briefs[id])];
    try { localStorage.setItem(SEEN, JSON.stringify(drawn)); } catch { /* placeholders for every row next time */ }
  }
}
function improveRow(glyph, tone, title, text, button) {
  const line = el('li', '');
  line.append(tile(glyph, tone), el('b', 'improve-name', title), emphasize(text), button);
  return line;
}
// Re-score: its cost said and confirmed first; then the kept scores are queued and a search starts at once (60 per search), shown like any
// search (header status, Recent activity, its result). 7 Oct 2026: it only queued them for later searches, so nothing seemed to happen.
let rescoring = false;
function confirmRescore(count, cost) {
  const dialog = $('rescore-dialog');
  $('rescore-title').textContent = `Re-score ${count} older score${count === 1 ? '' : 's'}?`;
  $('rescore-lead').textContent = `They are scored again against your current Profile, about ${cost.replace('≈ ', '')} of AI, spent once. ` +
    `A search starts now and scores up to 60 of them${count > 60 ? '; the rest in the next searches' : ''}. Nothing else changes.`;
  $('rescore-go').textContent = `Re-score · ${cost}`;
  dialog.returnValue = '';
  dialog.onclose = async () => {
    if (dialog.returnValue !== 'go' || rescoring) return;
    rescoring = true;
    drawImprove();
    try {
      const result = await window.pilot.rescorePrevious().catch(error => ({ok: false, error: error.message}));
      if (!result.ok) { toastMessage('Not re-scored', result.error); return; }
      toastMessage({title: 'Re-scoring now', body: `${result.queued} jobs get a new score in a refresh${result.queued > 60 ? ' (60 now, the rest in the next one)' : ''}. ` +
        'It shows in Recent activity as "Re-scoring".', target: null});
      await startSearch({reason: 'rescore', count: result.queued});   // its row says "Re-scoring N older scores", queued or running
    } finally {
      rescoring = false;
      loadStrategy();
    }
  };
  dialog.showModal();
}
// One row: icon, title, a line on what it is, Review (opens the options) and ⋯ (hide). options: [{label, preview, button, run(button)}].
// Ids kept from the banners (#strategy-foryou, #foryou-chips…): the e2e suites and the late-shift watch find them by these.
// Each row's id and its options' list, written out: the e2e suites (foryou) and the push check look for these words.
const ROW_IDS = {coverage: ['strategy-coverage', 'coverage-chips'], places: ['strategy-places', 'places-chips'], filters: ['strategy-filters', 'filters-chips'],
  sources: ['strategy-sources', 'sources-chips'], visits: ['strategy-visits', 'visits-chips'], foryou: ['strategy-foryou', 'foryou-chips'], ideas: ['strategy-ideas', 'ideas-chips']};
// Each kind's colour (owner, 7 Oct 2026: "bring this page to life"): blue for sources, teal for locations, violet for roles, amber for manual
// browsing; orange stays the action colour. Used by its tile here and in Improve your search.
const TONE = {places: 'teal', ideas: 'violet', coverage: 'violet', filters: 'neutral', sources: 'info', visits: 'warn', foryou: 'good'};
// Numbers carry the meaning ("30 matching roles", "8 suggestions"): bold, the words around them muted.
function emphasize(text) {
  const box = el('span', 'muted');
  for (const [i, part] of String(text).split(/(\d[\d,.']*)/).entries()) box.append(i % 2 ? el('b', 'figure', part) : part);
  return box;
}
// One card per kind: tile, bold title (and how many options), a line with its numbers, its action; Review opens the options under a tinted head.
// option: {label, why, meta?, tech?, button, accent?, run(button)}; body: drawn instead of the option cards (the sites, by company).
function suggestionRow({kind, id, glyph, title, summary, text, options = [], hidden = [], hiddenLabel = '', review = 'Review', menu, brief, note = '', body = null, count = null}) {
  briefs[id] = {glyph, ...brief};
  const tone = TONE[id] || 'neutral';
  const row = el('section', `suggestion-card tone-${tone}`);
  row.id = ROW_IDS[id][0];
  const detail = el('div', 'suggestion-detail');
  detail.id = `${ROW_IDS[id][0]}-detail`;
  detail.hidden = true;
  const closedLabel = brief?.cta || review;
  const toggle = el('button', 'secondary', closedLabel);
  toggle.type = 'button';
  toggle.dataset.review = kind;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', detail.id);
  const setOpen = open => {
    detail.hidden = !open;
    row.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Collapse' : closedLabel;
    if (open) openRows.add(id); else openRows.delete(id);
  };
  toggle.addEventListener('click', () => setOpen(detail.hidden));
  const optionCard = option => {
    const card = el('div', 'option-row option-card'), words = el('div', 'option-words');
    words.append(el('b', '', option.label), el('span', 'muted', option.why || option.preview || ''));
    if (option.meta) { const meta = el('span', 'option-meta', icon('info')); meta.append(option.meta); words.append(meta); }
    if (option.tech) { const more = el('details', 'plain option-tech'); more.append(el('summary', '', 'Search details'), el('span', 'muted small', option.tech)); words.append(more); }
    const button = el('button', `secondary${option.accent ? ' is-signal' : ''}`, option.button);
    Object.assign(button, {type: 'button', title: option.preview || option.why || ''});
    button.addEventListener('click', () => option.run(button));
    card.append(words, button);
    return card;
  };
  const chips = el('div', body ? 'site-list' : 'option-grid');
  chips.id = ROW_IDS[id][1];
  if (body) chips.append(...body); else chips.append(...options.map(optionCard));
  if (note) { const strip = el('p', 'suggestion-note', icon('info')); strip.append(note); detail.append(strip); }
  if (text) detail.append(el('p', 'muted small suggestion-text', text));
  detail.append(chips);
  if (hidden.length) {
    const more = el('button', 'link', `${hiddenLabel} (${hidden.length})`);
    more.type = 'button';
    more.addEventListener('click', () => { chips.append(...hidden.map(optionCard)); more.remove(); });
    detail.append(more);
  }
  const head = el('div', 'suggestion-head'), words = el('div', 'suggestion-words'), name = el('div', 'suggestion-title');
  name.append(el('h3', '', title), ...(count ? [pill(String(count), tone)] : []));
  words.append(name, typeof summary === 'string' ? emphasize(summary) : summary);
  head.append(tile(glyph, tone), words, toggle, moreButton(menu, `More about ${title.toLowerCase()}`));
  row.append(head, detail);
  if (openRows.has(id)) setOpen(true);
  adviceEvent('shown', kind, 'strategy');
  return row;
}
// ⋯ → hide this row until the next search brings a new verdict (its `at`): what "Not now" did, said plainly.
const hideItem = (kind, id, key, at) => ({label: 'Hide until the next search', icon: 'eye',
  title: 'This row comes back when a search brings new numbers. Your settings do not change.',
  run: () => { adviceEvent('dismissed', kind, 'strategy'); try { localStorage.setItem(key, at); } catch { /* shown again next time */ } rows[id] = null; drawSuggestions(); }});
// An option that changes your search (a role word, a place, a filter removed): saved to Search settings, then the rows are read again.
// While a draft changes the same list, applying waits: reviewing is fine, the change itself asks for Save or Discard first (owner, 7 Oct 2026).
const widen = (kind, act, done, list = '') => async button => {
  if (list && dirty().has(list)) {
    toastMessage('Save or discard your changes first', `This changes your ${LIST_WORDS[list]}, which you are editing now. Save or discard that draft, then add it.`);
    $('strategy-savebar').classList.remove('is-nudged'); void $('strategy-savebar').offsetWidth; $('strategy-savebar').classList.add('is-nudged');
    return;
  }
  const label = button.textContent;
  button.disabled = true;
  const result = await withSaveProgress(words => { button.textContent = words; }, act).catch(error => ({ok: false, error: error.message}));
  button.textContent = label;
  if (result.ok) adviceEvent('taken', kind, 'strategy');
  if (!result.ok) { toastMessage('Not added', result.error); button.disabled = false; return; }
  // The next step with it: a refresh searches with the change (7 Oct 2026: the pop-up said only "Search widened").
  toastMessage({title: 'Search widened', body: `${done} Refresh your jobs to search with it.`, action: refreshAction});
  loadStrategy();   // the cards show it at once, not after the next visit (it re-reads the suggestions too)
};

const refreshAction = {label: 'Refresh jobs', run: () => startSearch()};
const LIST_WORDS = {roles: 'roles', places: 'places', languages: 'excluded languages'};
const paintCoverage = verdict => {
  shownVerdict = verdict;
  const coverage = coverageCard(verdict, remembered());
  rows.coverage = coverage && suggestionRow({kind: 'coverage', id: 'coverage', glyph: 'search', title: verdict.local ? 'Catch titles in other languages' : 'Add role words',
    summary: `Your keywords catch ${number(verdict.matched)} of ${number(verdict.in_places)} postings in your places`, text: coverage.text,
    options: coverage.chips.map(chip => ({label: plain(chip.label), button: 'Add role word', preview: `Adds "${chip.term}" to your role words. ${chip.title}`,
      run: widen('coverage', () => window.pilot.addRoles([chip.term]), `"${chip.term}" is now a role word (also in your Search settings in Notion).`, 'roles')})),
    brief: {title: verdict.local ? 'Catch titles in other languages' : 'Add role words', text: `Your keywords catch ${number(verdict.matched)} of ${number(verdict.in_places)} postings in your places`, cta: 'Review role words'},
    menu: [hideItem('coverage', 'coverage', DISMISSED, coverage.at)]});
  const places = placesCard(verdict, remembered(PLACES_DISMISSED));
  const topPlace = places?.chips[0];
  rows.places = places && suggestionRow({kind: 'places', id: 'places', glyph: 'pin', title: 'Broaden locations',
    summary: `${topPlace.place} · ${number(topPlace.count)} matching role${topPlace.count === 1 ? '' : 's'} outside your places${places.chips.length > 1 ? `, and ${places.chips.length - 1} more place${places.chips.length > 2 ? 's' : ''}` : ''}`,
    text: places.text,
    options: places.chips.map(chip => ({label: plain(chip.label), button: 'Add place', preview: `Adds ${chip.place} to your places; jobs you already have stay. ${chip.title}`,
      run: widen('places', () => window.pilot.addPlaces([chip.place]), `${chip.place} is now one of your places (also in your Search settings in Notion). Jobs you already have stay.`, 'places')})),
    brief: {title: 'Expand your locations', text: `${number(topPlace.count)} matching role${topPlace.count === 1 ? '' : 's'} in ${topPlace.place}${places.chips.length > 1 ? ` and ${places.chips.length - 1} more place${places.chips.length > 2 ? 's' : ''}` : ''}`, cta: 'Review location'},
    menu: [hideItem('places', 'places', PLACES_DISMISSED, places.at)]});
  // Filters of the user's own that hide matching jobs: an option removes that filter.
  const filters = filtersCard(verdict, remembered(FILTERS_DISMISSED));
  const filterHidden = filters ? filters.chips.reduce((sum, chip) => sum + chip.count, 0) : 0;
  rows.filters = filters && suggestionRow({kind: 'filters', id: 'filters', glyph: 'sliders', title: 'Loosen your filters',
    summary: `${filters.chips.length} of your filters hide ${number(filterHidden)} matching job${filterHidden === 1 ? '' : 's'}`, text: filters.text,
    options: filters.chips.map(chip => ({label: plain(chip.label), button: 'Remove filter', preview: chip.title,
      run: widen('filters', () => window.pilot.loosenSearch(chip.exclude ? {excludes: [chip.exclude]} : {languages: [chip.language]}),
        chip.exclude ? `Titles with "${chip.exclude}" are no longer left out (also in your Search settings in Notion).`
          : `Jobs that require ${chip.language} are no longer hidden (also in your Search settings in Notion).`, chip.language ? 'languages' : '')})),
    brief: {title: 'Loosen your filters', text: `${filters.chips.length} of your filters hide ${number(filterHidden)} matching job${filterHidden === 1 ? '' : 's'}`, cta: 'Review filters'},
    menu: [hideItem('filters', 'filters', FILTERS_DISMISSED, filters.at)]});
  // Unused job sources: an option opens its panel in Settings → Connections (a key to add there); nothing is turned on from here.
  const sources = sourcesCard(verdict, remembered(SOURCES_DISMISSED));
  rows.sources = sources && suggestionRow({kind: 'source', id: 'sources', glyph: 'link', title: 'Connect more job sources', review: 'Set up',
    summary: sources.chips.map(chip => plain(chip.label).split(' · ')[0]).join(' · '), text: sources.text,
    options: sources.chips.map(chip => ({label: plain(chip.label), button: 'Open in Settings', preview: chip.title,
      run: () => { adviceEvent('taken', 'source', 'strategy', {source: chip.id}); openSetting(chip.id); }})),
    brief: {title: 'Connect more sources', text: sources.chips.map(chip => plain(chip.label).split(' · ')[0]).join(', '), cta: 'Set up'},
    menu: [hideItem('source', 'sources', SOURCES_DISMISSED, sources.at)]});
  // Sites only you can open: one chip per company in the row; Review lists every page (a company can have two genuinely different ones).
  const visits = visitCard(verdict, remembered(VISITS_DISMISSED));
  if (visits) {
    const sites = sitesByName(visits.chips);
    const openPage = chip => async () => {
      adviceEvent('taken', 'visit', 'strategy');
      const opened = await window.pilot.openVisit(chip.url).catch(error => ({ok: false, error: error.message}));
      toastMessage(opened.ok ? 'Opened in Chrome' : 'Not opened', opened.ok ? `Click the Job Pilotto icon there, then "Read the jobs on this page".${chip.note ? ` ${chip.note}.` : ''}` : opened.error);
    };
    // By company (owner mockup, 7 Oct 2026): a letter tile, the name, how many pages, each page's own link (its real address), Open for the first.
    const TINTS = ['info', 'teal', 'violet', 'good'];
    const company = (site, i) => {
      const line = el('div', 'site-row'), words = el('div', 'site-words'), name = el('div', 'site-name'), links = el('div', 'site-links');
      name.append(el('b', '', site.name), ...(site.pages.length > 1 ? [pill(`${site.pages.length} destinations`)] : []));
      links.append(...site.pages.map(page => {
        const link = el('button', 'link', hostOf(page.url) || page.url);
        Object.assign(link, {type: 'button', title: page.title});
        link.addEventListener('click', openPage(page));
        return link;
      }));
      words.append(name, links);
      const open = el('button', 'secondary with-icon', 'Open');
      Object.assign(open, {type: 'button', title: site.pages[0].title});
      open.append(icon('external'));
      open.addEventListener('click', openPage(site.pages[0]));
      line.append(el('span', `ui-tile tone-${TINTS[i % TINTS.length]} site-avatar`, site.name.trim()[0]?.toUpperCase() || '?'), words, open);
      return line;
    };
    const SHOWN = 5;
    const list = sites.slice(0, SHOWN).map(company);
    if (sites.length > SHOWN) {
      const all = el('button', 'link site-all', `View all ${sites.length} sites →`);
      all.type = 'button';
      all.addEventListener('click', () => { all.replaceWith(...sites.slice(SHOWN).map((site, i) => company(site, i + SHOWN))); });
      list.push(all);
    }
    rows.visits = suggestionRow({kind: 'visit', id: 'visits', glyph: 'external', title: 'Browse sites manually', count: sites.length,
      summary: 'Open a site in Chrome, then use Job Pilotto → Read the jobs on this page.', text: '', body: list,
      brief: {title: `${sites.length} site${sites.length === 1 ? ' needs' : 's need'} manual browsing`, text: 'Use the Chrome extension', cta: 'View sites'},
      menu: [hideItem('visit', 'visits', VISITS_DISMISSED, visits.at)]});
  } else rows.visits = null;
  // Employers where people like you got interviews (shared pool): an option shows that employer's jobs in the Jobs list.
  const forYou = employersCard(verdict, remembered(FORYOU_DISMISSED));
  rows.foryou = forYou && suggestionRow({kind: 'employer', id: 'foryou', glyph: 'building', title: 'Employers hiring people like you',
    summary: forYou.chips.slice(0, 3).map(chip => chip.company).join(' · ') + (forYou.chips.length > 3 ? ` and ${forYou.chips.length - 3} more` : ''), text: forYou.text,
    options: forYou.chips.map(chip => ({label: chip.label, button: 'See their jobs', preview: chip.title, run: () => {
      adviceEvent('taken', 'employer', 'strategy');
      openView('jobs');
      const box = $('filter-text');
      if (box) { box.value = chip.company; box.dispatchEvent(new Event('input', {bubbles: true})); }
    }})),
    brief: {title: 'Employers hiring people like you', text: forYou.chips.slice(0, 3).map(chip => chip.company).join(', ') + (forYou.chips.length > 3 ? ` and ${forYou.chips.length - 3} more` : ''), cta: 'See employers'},
    menu: [hideItem('employer', 'foryou', FORYOU_DISMISSED, forYou.at)]});
  drawSuggestions();
  if (strategyShown && !targetEdits) renderTargets();   // the exclusions card says what the languages hid
};
// first: called when the page starts to load, beside the strategy read (not after it).
export async function loadCoverage({first = false} = {}) {
  if (first) {
    const last = lastVerdict();
    if (last) paintCoverage(last.verdict); else { checking = true; drawSuggestions(); }
  }
  const answer = await window.pilot.searchCoverage().catch(() => null);
  checking = false;
  const verdict = answer?.ok ? answer.coverage : null;
  if (answer?.ok) { try { localStorage.setItem(LAST, JSON.stringify({verdict})); } catch { /* the rows still show */ } }
  paintCoverage(verdict);
  await loadIdeas();
  pendingReview = '';   // the row it asked for is not there any more (hidden, or the search changed): nothing opens later by surprise
}
// "Explore related roles" (src/ai/role_ideas.py, owner 7 Oct 2026: "suggest potential roles"): roles from the Profile with how many open jobs in
// your places each would add; those with openings first, the empty ones behind "Show more". ⋯ sets them aside: the engine never proposes them again.
const IDEAS_ASIDE = 'jp.ideas.aside';
const aside = () => { try { return JSON.parse(localStorage.getItem(IDEAS_ASIDE) || '[]'); } catch { return []; } };
// The last answer, kept: the engine asks Claude at most once a day (src/ai/role_ideas.py), so the kept ideas are today's and the row shows at
// the first paint (owner, 7 Oct 2026: the rows "add up after 5-10 seconds"). The fresh answer then replaces them quietly.
const IDEAS_LAST = 'jp.ideas.last';
const keptIdeas = () => { try { const kept = JSON.parse(localStorage.getItem(IDEAS_LAST) || 'null'); return Array.isArray(kept) ? kept : null; } catch { return null; } };
async function loadIdeas() {
  const kept = keptIdeas();
  if (kept) paintIdeas(kept);
  else { pendingImprove.add('ideas'); drawImprove(); }   // nothing kept yet: a placeholder holds its place while the engine answers
  const answer = await window.pilot.roleIdeas?.(aside()).catch(() => null);
  pendingImprove.delete('ideas');
  const fresh = answer?.ok && Array.isArray(answer.ideas);
  if (fresh) { try { localStorage.setItem(IDEAS_LAST, JSON.stringify(answer.ideas)); } catch { /* shown when it answers */ } }
  paintIdeas(fresh ? answer.ideas : kept || []);   // the engine could not answer: the kept ideas stay
}
function paintIdeas(ideas) {
  // A kept idea already added as a role is not offered again (the engine leaves it out of its next answer too).
  const searched = new Set(entriesOf(lastStrategy, 'roles').map(entry => String(entry.fragment).toLowerCase()));
  const card = ideasCard((ideas || []).filter(idea => !searched.has(String(idea.word).toLowerCase())), aside());
  if (!card) { rows.ideas = null; drawSuggestions(); return; }
  // A card each: the role, why it fits, its openings; the word it is searched by under "Search details" (owner mockup, 7 Oct 2026).
  const option = chip => ({label: chip.role || plain(chip.label).replace(/ · \d+$/, ''), why: String(chip.why || '').replace(/\.+$/, '.'), button: '+ Add role', accent: true,
    meta: `${chip.count} opening${chip.count === 1 ? '' : 's'} now in your places`, tech: `Searched as "${chip.term}" in job titles. Adding it makes the next searches look for it.`,
    preview: `Adds "${chip.term}" to your role words: ${chip.title}`,
    run: widen('ideas', () => window.pilot.addRoles([chip.term]), `"${chip.term}" is now a role word (also in your Search settings in Notion).`, 'roles')});
  const {open, empty} = byOpenings(card.chips);
  const top = open[0];
  rows.ideas = suggestionRow({kind: 'ideas', id: 'ideas', glyph: 'briefcase', title: 'Explore related roles', count: card.chips.length,
    note: open.length ? '' : 'No current openings found in your selected locations.',
    summary: top ? `${plain(top.label).replace(/ · \d+$/, '')} · ${top.count} open role${top.count === 1 ? '' : 's'}${open.length > 1 ? `, and ${open.length - 1} more` : ''}`
      : `${empty.length} role${empty.length === 1 ? '' : 's'} from your Profile, none with openings in your places now`,
    text: 'Based on your Profile. A role you add is included in your future searches.', options: (open.length ? open : empty).map(option), hidden: open.length ? empty.map(option) : [],
    hiddenLabel: 'Show roles with no current openings',
    brief: {title: 'Explore related roles', text: `${card.chips.length} suggestion${card.chips.length === 1 ? '' : 's'}${open.length ? `, ${open.length} with openings in your places` : ', no current openings in your places'}`, cta: 'Review roles'},
    menu: [{label: 'Don’t suggest these roles again', icon: 'close', title: 'Sets these roles aside for good; new ones can still be suggested.', run: () => {
      adviceEvent('dismissed', 'ideas', 'strategy');
      try { localStorage.setItem(IDEAS_ASIDE, JSON.stringify([...new Set([...aside(), ...card.chips.map(chip => chip.term)])].slice(-60))); } catch { /* shown again next time */ }
      rows.ideas = null;
      drawSuggestions();
    }}]});
  drawSuggestions();
}

// Tabs (owner, 7 Oct 2026): each replaces the content under the bar; the draft and its save bar stay whatever the tab.
function showTab(id) {
  for (const tab of document.querySelectorAll('.strategy-tabs [data-tab]')) {
    const on = tab.dataset.tab === id;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', String(on));
    show($(tab.dataset.tab), on);
  }
}
// Leaving Strategy with unsaved changes: the one place the draft asks (Save / Discard / Keep editing). Switching tabs never asks.
function leaveStrategy(proceed) {
  if (!targetEdits || !dirty().size) return true;
  const dialog = $('strategy-leave-dialog');
  dialog.returnValue = '';
  dialog.onclose = async () => {
    if (dialog.returnValue === 'discard') { discardTargets(); proceed(); }
    if (dialog.returnValue === 'save' && await saveTargets()) proceed();
  };
  dialog.showModal();
  return false;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // A page read through the extension (Sites only you can open): said wherever the window is, once per page.
  // Few new jobs twice in a row (lib/few-jobs.js): a dot on Strategy until it is opened.
  window.pilot.onFewJobs?.(() => show($('strategy-dot'), true));
  document.querySelector('.nav[data-view=strategy]')?.addEventListener('click', () => show($('strategy-dot'), false));
  window.pilot.onVisitRead?.(answer => toastMessage(answer.fits === undefined ? `Read ${answer.jobs} jobs from ${answer.name}` : `Read ${answer.jobs} jobs from ${answer.name}, ${answer.fits} matching your search`,
    answer.fits ? 'Your next jobs check scores the matching ones: those that fit your profile join your Jobs list.' : 'The reading works; none of these match your role words and places, so your Jobs list stays the same.'));
  for (const tab of document.querySelectorAll('.strategy-tabs [data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
  guardLeave('strategy', leaveStrategy);
  $('profile-empty-rebuild').addEventListener('click', () => $('strategy-redo').click());   // the same Rebuild from CV as the Profile page
  $('targets-cancel').addEventListener('click', discardTargets);
  $('targets-save').addEventListener('click', saveTargets);
  $('strategy-edit').addEventListener('click', event => openInNotion(shared.state.notion?.NOTION_SEARCH_SETTINGS_PAGE ? 'NOTION_SEARCH_SETTINGS_PAGE' : 'NOTION_PROFILE_PAGE_ID', event));   // busy state: openInNotion
  $('strategy-jobs').addEventListener('click', () => openView('jobs'));
}

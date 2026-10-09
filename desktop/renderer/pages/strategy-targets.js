// Strategy page, goals and targets: the four target cards, their lists (chips, Edit, Save, remote choice), goals, renderStrategy. Guarded by: test/save-progress.test.js (and test/strategy-targets.test.js for lib/strategy.js).
import {withSaveProgress} from '../save-progress.js';
import {el, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, message, show} from './core.js';
import {openView} from './nav.js';
import {toastMessage} from './startup.js';
import {titleCase} from './strategy-review.js';
import {goalTiles} from '../goal-tiles.js';
import {showSearchChanged, wireSearchChanged} from '../search-changed.js';
import {dirtyLists, exclusionGroups, roleFamilies, withTyped} from '../strategy-parts.js';
import {strategyState} from './strategy-state.js';
import {loadStrategy} from './strategy.js';
import {drawImprove, refreshAction} from './strategy-suggestions.js';

// ---------- Your goals and the setup review's cards, with your live settings (owner, 7 Oct 2026: the page lacked work mode, salary,
// languages, search terms, excluded languages and work rights, which the setup review shows). Lists: Edit → Save (lib/strategy.js editLists,
// to ⚙️ Search settings); goals: corrected one at a time in the Profile (lib/goals.js), like the review.
// [card, icon, title, its lists: [list, label or note, what the add field asks]]
// Owner mockup, 7 Oct 2026: four cards (roles with their search terms, places with eligibility, skills, exclusions); every list still edits here.
export const CARD_TONE = {roles: 'violet', places: 'teal', stack: 'info', languages: 'warn', search: 'neutral'};   // the same colours as the suggestions of each kind
export const TARGET_CARDS = [
  ['roles', 'briefcase', 'Roles & job board searches', [['roles', '', 'Add a job title'], ['queries', 'Job board searches: what we type into job boards such as jobs.ch', 'Add a job board search']]],
  ['places', 'pin', 'Locations & eligibility', [['places', 'Priority locations', 'Add a city or region'], ['country', 'Additional regions', 'Add a country or region'],
    ['abroad', 'Relocation (open to)', 'Add a city abroad'], ['rights', 'Work rights: where you can work without a visa', 'Add a country or EU']]],
  ['stack', 'layers', 'Skills & experience', [['stack', 'Key skills and tools you want in jobs.', 'Add a skill or tool']]],
  ['languages', 'shield', 'Exclusions & preferences', [['languages', 'Languages that rule a job out', 'Add a language']]],
  // What only the ⚙️ Search settings page had (P8, 9 Oct 2026), so every store edits it here (lib/strategy-edit.js), with the level and the digest's minimum.
  ['search', 'search', 'More search settings', [['titleSkip', 'Job titles to skip', 'Add a word'], ['skip', 'Companies to skip', 'Add a company'], ['remoteSkip', 'Remote jobs: regions to skip', 'Add a region'],
    ['finders', 'Words that find new employers', 'Add a word'], ['gqueries', 'Google Jobs searches', 'Add a search'],
    ['gplaces', 'Google Jobs places: "City,Region,Country · language"', 'Add a place, e.g. Zurich,Zurich,Switzerland · de']]],
];
// A card's one-value settings, edited as {set} (not lists): they mark the card Edited too.
const CARD_VALUES = {places: ['remote'], search: ['level', 'minScore']};
const valuesDirty = (key, changed) => (CARD_VALUES[key] || []).some(name => changed.has(name));
export const TARGET_LISTS = TARGET_CARDS.flatMap(([, , , lists]) => lists.map(([name]) => name));
// targetEdits (on strategyState): {list: {add: [words], remove: [stored entries]}, remote: {set}} while editing
let typed = {};   // the text still in each list's input (not yet added with Enter): part of the draft
export const dirty = () => dirtyLists(strategyState.targetEdits, typed);
// Two columns that stack on their own (owner, 7 Oct 2026: cards sharing a grid row left tall gaps under the shorter one when zoomed out).
const COLUMNS = [['roles', 'stack', 'search'], ['places', 'languages']];
export const inColumns = cards => COLUMNS.map(keys => {
  const column = el('div', 'target-column');
  column.append(...keys.map(key => cards.find(card => card.dataset.list === key)).filter(Boolean));
  return column;
});
// A list's entries as stored ({fragment, label}): the match lists come as both, the plain ones (search phrases, languages) as written.
export const entriesOf = (data, name) => data?.lists?.[name] || (data?.texts?.[name] || []).map(text => ({fragment: text, label: text}));
// One list as it will be after Save: the stored entries not removed, then the words added.
export function editedList(entries, edit = {add: [], remove: []}) {
  const gone = new Set(edit.remove);
  return [...entries.filter(entry => !gone.has(entry.fragment)).map(entry => ({...entry, added: false})),
    ...edit.add.map(word => ({fragment: '', label: word, added: true}))];
}
const PLAIN = new Set(['queries', 'languages', 'skip', 'gqueries', 'gplaces']);   // stored as typed, not lower-cased
const AS_TYPED = new Set(['skip', 'gplaces']);   // shown as typed too: a company's own spelling, a place's language code ("de", not "De")
function listChips(name, placeholder) {
  const editing = !!strategyState.targetEdits, edit = editing ? (strategyState.targetEdits[name] ||= {add: [], remove: []}) : null;
  const stored = entriesOf(strategyState.lastStrategy, name);
  const box = el('div', 'chips');
  const entries = editing ? editedList(stored, edit) : stored;
  box.append(...entries.map(entry => {
    const pill = el('span', `chip${editing ? ' removable' : ''}${entry.added ? ' is-added' : ''}`);
    pill.append(el('span', '', AS_TYPED.has(name) ? entry.label : titleCase(entry.label)));
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
  const now = strategyState.lastStrategy?.remote_jobs !== false, chosen = strategyState.targetEdits?.remote ? strategyState.targetEdits.remote.set === 'Yes' : now;
  if (!strategyState.targetEdits) return el('span', '', now ? 'Anywhere: remote jobs count as one of your places' : 'Only those based in your locations');
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Remote jobs');
  for (const [label, yes] of [['Yes', true], ['No', false]]) {
    const button = el('button', yes === chosen ? 'is-active' : '', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(yes === chosen));
    button.addEventListener('click', () => {
      if (yes === now) delete strategyState.targetEdits.remote; else strategyState.targetEdits.remote = {set: label};
      renderTargets();
    });
    group.append(button);
  }
  return group;
}
// Your level (Search settings "Your level"): postings whose title plainly names another level are skipped; Any keeps them all.
const LEVELS = [['', 'Any'], ['junior', 'Junior'], ['mid', 'Mid'], ['senior', 'Senior'], ['lead', 'Lead']];
function levelChoice() {
  const now = strategyState.lastStrategy?.level || '', chosen = strategyState.targetEdits?.level ? strategyState.targetEdits.level.set : now;
  if (!strategyState.targetEdits) return el('span', '', LEVELS.find(([value]) => value === now)?.[1] || 'Any');
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Your level');
  for (const [value, label] of LEVELS) {
    const button = Object.assign(el('button', value === chosen ? 'is-active' : '', label), {type: 'button'});
    button.setAttribute('aria-pressed', String(value === chosen));
    button.addEventListener('click', () => {
      if (value === now) delete strategyState.targetEdits.level; else strategyState.targetEdits.level = {set: value};
      renderTargets();
    });
    group.append(button);
  }
  return group;
}
// The digest's minimum fit score (Search settings "Minimum fit score for the digest"; the engine's default is 50).
function minScoreInput() {
  const now = strategyState.lastStrategy?.digest_min_score ?? 50;
  if (!strategyState.targetEdits) return el('span', '', `${now} / 100: lower scores stay in your list, out of the digest`);
  const input = Object.assign(document.createElement('input'), {type: 'number', min: 0, max: 100, step: 1, className: 'add',
    value: strategyState.targetEdits.minScore?.set ?? now});
  input.setAttribute('aria-label', 'Minimum fit score for the digest');
  input.addEventListener('change', () => {
    const value = Math.round(Number(input.value));
    if (!Number.isFinite(value) || value < 0 || value > 100 || value === now) delete strategyState.targetEdits.minScore;
    else strategyState.targetEdits.minScore = {set: value};
    refreshDraft();
  });
  return input;
}
function targetCard([key, glyph, title, lists]) {
  const card = el('section', 'card');
  card.dataset.list = key;
  const head = el('div', 'card-head'), heading = el('h3');
  heading.append(tile(glyph, CARD_TONE[key] || 'neutral'), title);
  const badge = pill('Edited', 'warn');
  badge.classList.add('edited-badge');
  badge.hidden = !lists.some(([name]) => dirty().has(name)) && !valuesDirty(key, dirty());
  heading.append(badge);
  head.append(heading);
  if (!strategyState.targetEdits) {
    const edit = el('button', 'link with-icon card-edit', icon('edit'));
    edit.append(el('span', '', 'Edit'));
    Object.assign(edit, {type: 'button', title: `Edit ${title.toLowerCase()}`});
    edit.setAttribute('aria-label', edit.title);
    edit.addEventListener('click', startTargetsEdit);
    head.append(edit);
  }
  card.append(head);
  if (!strategyState.targetEdits) { card.append(...VIEWS[key]()); return card; }
  for (const [name, label, placeholder] of lists) {
    const box = listChips(name, placeholder);
    if (name === 'places') { const priority = el('div', 'priority'); priority.append(el('b', '', label), box); card.append(priority); continue; }
    if (label) card.append(el('p', 'sub', label));
    card.append(box);
  }
  if (key === 'places') card.append(el('p', 'sub', 'Remote jobs'), remoteChoice());
  if (key === 'search') card.append(el('p', 'sub', 'Your level'), levelChoice(), el('p', 'sub', 'Minimum fit score for the digest'), minScoreInput());
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
const labelsOf = name => entriesOf(strategyState.lastStrategy, name).map(entry => entry.label);
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
    const families = roleFamilies(entriesOf(strategyState.lastStrategy, 'roles')).map(family => {
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
  search() {
    const row = (glyph, label, name, none) => { const labels = labelsOf(name); return settingRow(glyph, label, !labels.length ? none : AS_TYPED.has(name) ? chipsOf(labels, false) : folded(labels, 6, 'Show all')); };
    return [settingRow('user', 'Your level', levelChoice()), settingRow('target', 'Minimum fit score for the digest', minScoreInput()),
      row('close', 'Job titles to skip', 'titleSkip', 'None'), row('building', 'Companies to skip', 'skip', 'None'), row('globe', 'Remote jobs: regions to skip', 'remoteSkip', 'None'),
      row('sparkle', 'Words that find new employers', 'finders', 'None'), row('search', 'Google Jobs searches', 'gqueries', 'None: Google Jobs is not searched'),
      row('pin', 'Google Jobs places', 'gplaces', 'None')];
  },
  languages() {
    const {languages, hide, lower} = exclusionGroups(strategyState.lastStrategy);
    const block = el('div', 'setting-body');
    block.append(languages.length ? chipsOf(languages) : el('span', 'muted', 'None'),
      el('span', 'muted small', 'A job that requires one is hidden; one that only prefers it ranks lower.'));
    // Warning colour only for a consequence: the last coverage check counted matching jobs these languages hid (src/coverage.py).
    const listed = new Set(languages.map(language => language.toLowerCase()));
    const hidden = (strategyState.shownVerdict?.languages || []).filter(item => listed.has(String(item.language).toLowerCase())).reduce((sum, item) => sum + (item.count || 0), 0);
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
  if (!result.ok) { toastMessage('Goal not saved', result.error || 'Try again.'); value.textContent = strategyState.lastStrategy?.goals?.[key] || '—'; return; }
  toastMessage('Goal saved ✓', 'It is in your Profile now. Your jobs are re-scored with it over the next searches.');
  strategyState.lastStrategy = {...strategyState.lastStrategy, goals: {...strategyState.lastStrategy.goals, [key]: text}};
  renderGoals();
}
function renderGoals() {
  // A Profile written before the goals rows: its Compensation line and the search's level stand in until a goal is corrected.
  const goals = strategyState.lastStrategy?.goals && {...strategyState.lastStrategy.goals, minimum_salary: strategyState.lastStrategy.goals.minimum_salary || strategyState.lastStrategy.compensation || '',
    seniority: strategyState.lastStrategy.goals.seniority || (strategyState.lastStrategy.level ? titleCase(strategyState.lastStrategy.level) : '')};
  $('strategy-goals').replaceChildren(...goalTiles(goals || {}, goals ? saveGoal : null));
}
export function renderTargets() {
  const editing = !!strategyState.targetEdits;
  $('strategy-live').classList.toggle('is-editing', editing);
  $('strategy-targets').replaceChildren(...inColumns(TARGET_CARDS.map(targetCard)));
  refreshDraft();
}
// The save bar and the Edited badges, from the draft (typing redraws only these, so the input keeps its focus).
let saving = false;
function refreshDraft() {
  const changed = dirty();
  show($('strategy-savebar'), !!strategyState.targetEdits);
  if (!strategyState.targetEdits) return;
  $('savebar-title').textContent = changed.size ? 'Unsaved strategy changes' : 'Editing your strategy';
  $('savebar-sub').textContent = changed.size ? 'Applies to future searches.' : 'Add or remove what you want, then save.';
  $('targets-save').disabled = saving || !changed.size;
  $('targets-cancel').disabled = saving;
  $('targets-cancel').textContent = changed.size ? 'Discard changes' : 'Done';
  for (const card of document.querySelectorAll('#strategy-targets .card[data-list]')) {
    const [key, , , lists] = TARGET_CARDS.find(([name]) => name === card.dataset.list);
    const badge = card.querySelector('.edited-badge');
    if (badge) badge.hidden = !lists.some(([name]) => changed.has(name)) && !valuesDirty(key, changed);
  }
}
function startTargetsEdit() {
  if (!strategyState.lastStrategy?.lists) return;
  strategyState.targetEdits ||= {};
  message('targets-message', '');
  renderTargets();
}
export function discardTargets() {
  strategyState.targetEdits = null;
  typed = {};
  message('targets-message', '');
  renderTargets();
}
// One save for the whole draft, words still typed included. On failure the draft stays, with Retry; "Synced to Notion" only once it is.
export async function saveTargets() {
  if (saving || !strategyState.targetEdits) return false;
  const edits = withTyped(strategyState.targetEdits, typed, PLAIN, name => entriesOf(strategyState.lastStrategy, name));
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
  strategyState.targetEdits = null;
  typed = {};
  // Saved to Search settings; when Notion is connected, editLists has published it there before answering ok (lib/strategy.js).
  toastMessage({title: 'Strategy saved ✓', body: `${shared.state?.notionConnected ? 'Synced to Notion. ' : ''}Refresh your jobs to search with it.`, action: refreshAction});
  await loadStrategy();
  renderTargets();
  return true;
}

export function renderStrategy(data) {
  strategyState.strategyShown = true;
  strategyState.lastStrategy = data;
  show($('strategy-profile-empty'), !!data.profile_empty);
  wireSearchChanged();
  showSearchChanged(shared.state?.settings);   // scores are paused until it is filled (src/ai/score.py unfilled)
  if (strategyState.targetEdits) { renderTargets(); drawImprove(); return; }   // a fresh read while editing keeps the edits on screen
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

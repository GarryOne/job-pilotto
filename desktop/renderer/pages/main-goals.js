// Strategy → Main goals (owner, 18 Oct 2026, UI redesign B, mockup 03 + decisions 1, 2 and 4): four tiles, Target roles · Target level · Work mode ·
// Minimum salary (page-parts.js summaryTiles: four columns, 2×2 when narrow; the salary with its currency and period said), a "From Your details" row with
// Languages and Work eligibility as recorded there (page-parts.js referenceRow: read-only, never goals), and one editor behind Edit: the roles list, then each
// goal with its kind's control (goal-kinds.js). Saved by Strategy's page bar (strategy-cards.js): roles to Search settings, goals to the Profile
// (lib/goals.js; Target level also sets the search's level, lib/goal-level.js). Guarded by test/main-goals.test.js.
import {el} from '../components.js';
import {editRows} from '../card-shell.js';
import {referenceRow, summaryTiles} from '../page-parts.js';
import {answerControl} from '../question-control.js';
import {formatFor} from '../question-kind.js';
import {GOAL_KINDS} from '../goal-kinds.js';
import {goalNote, roleFamilies, salaryWords, detailsLine} from '../strategy-parts.js';
import {$} from './core.js';
import {openSetting} from './settings.js';
import {titleCase} from './strategy-review.js';
import {strategyState} from './strategy-state.js';
import {GOAL_LABELS, cardHeader, changed, drafts, isOpen} from './strategy-cards.js';
import {draftEntries, listChips} from './strategy-targets.js';

const TILES = [['roles', 'briefcase', 'Target roles'], ['seniority', 'user', 'Target level'], ['work_mode', 'building', 'Work mode'], ['minimum_salary', 'chart', 'Minimum salary']];
const TONES = {roles: 'violet', seniority: 'teal', work_mode: 'good', minimum_salary: 'info'};

// The saved goals, a Profile written before the goals rows standing in with its Compensation line and the search's level.
function savedGoals() {
  const data = strategyState.lastStrategy || {};
  return {...(data.goals || {}), minimum_salary: data.goals?.minimum_salary || data.compensation || '',
    seniority: data.goals?.seniority || (data.level ? titleCase(data.level) : '')};
}
const goalNow = key => (key in (strategyState.goalEdits || {}) ? strategyState.goalEdits[key] : savedGoals()[key] || '');

// Target roles as read: the role families' first titles, the draft included, "+N more" for the rest.
function rolesValue() {
  const titles = roleFamilies(draftEntries('roles')).flatMap(family => family.entries.map(entry => titleCase(entry.label)));
  if (!titles.length) return {text: '', note: 'No roles yet: Edit to add one.'};
  return {text: titles.slice(0, 3).join(' · '), note: titles.length > 3 ? `+${titles.length - 3} more` : '', title: titles.join(', ')};
}
function tileValue(key) {
  if (key === 'roles') return rolesValue();
  const {text, note} = goalNote(key, goalNow(key));
  if (key === 'minimum_salary') return {...salaryWords(text), ...(note === 'estimated' ? {note: 'Estimated by the AI: Edit to confirm it'} : {})};
  const shown = GOAL_KINDS[key]?.read && text ? GOAL_KINDS[key].read(text) || text : text;
  return {text: shown};
}

const tiles = () => summaryTiles(TILES.map(([key, glyph, label]) => {
  const {text, note, title} = tileValue(key);
  return {key, icon: glyph, tone: TONES[key], label, value: text, note, title};
}));

// Languages and Work eligibility as Your details recorded them (owner, 18 Oct 2026: "Show the actual recorded eligibility without inferring broader work
// rights"): the shared reference row (page-parts.js), the one link to where they are edited.
function fromDetails() {
  const details = strategyState.lastStrategy?.details, words = detailsLine(details, savedGoals().languages);
  if (!words) return null;
  const section = details?.languages?.length || savedGoals().languages ? 'languages' : 'eligibility';   // the first fact the line names
  return referenceRow({text: words, open: () => openSetting(section)});
}

function editor() {
  const rows = [{label: 'Target roles', control: listChips('roles', 'Add a job title'), hint: 'The job titles your search looks for.'}];
  for (const [key, , label] of TILES.slice(1)) {
    const kind = GOAL_KINDS[key], saved = savedGoals()[key] || '';
    const format = formatFor({marked: {kind: kind.kind, options: kind.options || []}});
    const now = goalNow(key), shown = kind.read ? kind.read(now) || now : now;
    const control = answerControl(format, shown, next => {
      if (String(next || '').trim() && String(next).trim() !== saved) drafts().goalEdits[key] = String(next).trim(); else delete drafts().goalEdits[key];
      changed();
    }, {ariaLabel: GOAL_LABELS[key] || label, chips: kind.chips});
    rows.push({label, control, hint: key === 'seniority' ? 'Also the level your search keeps: postings that plainly name another level are skipped.' : ''});
  }
  const box = el('div', 'card-editor');
  box.append(editRows(rows));
  return box;
}

export function renderMainGoals() {
  const host = $('strategy-main-goals');
  if (!host) return;
  const card = el('section', `card main-goals${isOpen('goals') ? ' is-editing' : ''}`);
  card.dataset.card = 'goals';
  const read = el('div', 'card-read');
  read.append(tiles(), ...[fromDetails()].filter(Boolean));
  card.append(cardHeader('goals', 'target', 'signal', 'Main goals', 'What every job is scored against.', card), read, ...(isOpen('goals') ? [editor()] : []));
  host.replaceChildren(card);
}

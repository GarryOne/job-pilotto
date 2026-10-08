// Jobs page, questions to answer once: cached list, read from Notion, Save/Skip. Guarded by: test/question-save.test.js, questions-load-error.test.js, questions-error-text.test.js.
import {el} from '../components.js';
import {$, show} from './core.js';
import {questionsProblem} from '../questions-view.js';

// Answer once: the questions saved last time show at once (cached on this computer), then Notion's answer replaces
// them (only if they changed, so nothing you're typing is lost). No cache yet: a shimmer where the count goes.
const QUESTIONS_CACHE = 'questionsCache';
let questionsShown = '';
$('questions-retry').addEventListener('click', () => { questionsShown = ''; loadQuestions({force: true}); });
// Reading the questions walks the whole answers page (about 50 Notion calls, which queue ahead of every other read): not on every Jobs reload (each save, dismiss, kit…).
// It is read again at the first load, after 10 minutes, and at once when something changed it: Retry, an answer, a fill that added questions (`onMoved`, from lib/server.js).
const QUESTIONS_FRESH_MS = 10 * 60 * 1000;
let questionsReadAt = 0;
export async function loadQuestions({force = false} = {}) {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(QUESTIONS_CACHE) || 'null'); } catch {}
  if (!questionsShown) {
    if (Array.isArray(cached)) renderQuestions(cached);
    else {
      $('questions').classList.add('is-loading');
      $('questions-count').replaceChildren(el('span', 'skeleton questions-skeleton'));
      show($('questions'));
    }
  }
  if (!force && questionsReadAt && Date.now() - questionsReadAt < QUESTIONS_FRESH_MS && Array.isArray(cached)) return;   // fresh enough: what is shown stands
  const {list, error} = await window.pilot.openQuestions();
  $('questions').classList.remove('is-loading');
  if (!error) questionsReadAt = Date.now();
  if (error && Array.isArray(cached)) return;  // Notion unreachable: keep the saved questions
  if (!error) try { localStorage.setItem(QUESTIONS_CACHE, JSON.stringify(list)); } catch {}
  renderQuestions(list, error);
}
function renderQuestions(list, error = '') {
  const shown = JSON.stringify([list, error]);
  if (shown === questionsShown) return;
  questionsShown = shown;
  // Collapsed by default (the count shows on its heading); shown whenever there's something to answer or a read failed.
  // Notion not connected yet (trying only): nothing to read, so no error card.
  if (error && questionsProblem(error).hide) { show($('questions'), false); return; }
  show($('questions'), list.length > 0 || !!error);
  $('questions-count').textContent = error ? 'couldn\'t load' : `${list.length} question${list.length === 1 ? '' : 's'}`;
  $('questions-error').textContent = error ? questionsProblem(error).text : '';
  show($('questions-error'), !!error);
  show($('questions-retry'), !!error);
  if (error) $('questions').open = true;  // the reason and Retry sit inside: don't leave them collapsed
  $('questions-list').replaceChildren(...list.map(q => {
    const row = Object.assign(document.createElement('div'), {className: 'question'});
    const label = Object.assign(document.createElement('label'), {textContent: q.question});
    if (q.company) label.append(Object.assign(document.createElement('small'), {textContent: ` · asked by ${q.company}`}));
    const input = Object.assign(document.createElement('input'), {type: 'text', placeholder: 'Your standard answer'});
    if (q.hint) label.append(Object.assign(document.createElement('small'), {className: 'muted', textContent: ` · ${q.hint}`}));
    const save = Object.assign(document.createElement('button'), {className: 'secondary', textContent: 'Save'});
    const skip = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Skip',
      title: q.hint !== undefined ? 'Forms leave this field empty (the table row stays, answered "— (leave blank)")' : 'Not a question to keep an answer for'});
    const note = Object.assign(document.createElement('span'), {className: 'message'});
    const answer = async value => {
      save.disabled = skip.disabled = true;
      const result = await window.pilot.answerQuestion(q.key, value);
      if (result.ok) loadQuestions({force: true}); else { note.className = 'message error'; note.textContent = result.error; skip.disabled = false; save.disabled = !input.value.trim(); }
    };
    // Save waits for an answer: an enabled Save that silently did nothing on an empty field read as broken (UI loop #64).
    save.disabled = true;
    input.addEventListener('input', () => { save.disabled = !input.value.trim(); });
    save.addEventListener('click', () => input.value.trim() && answer(input.value.trim()));
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && input.value.trim()) answer(input.value.trim()); });
    skip.addEventListener('click', () => answer(''));
    row.append(label, input, save, skip, note);
    return row;
  }));
}

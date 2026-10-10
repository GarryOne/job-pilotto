// Settings → Profile → Experience: the sources of what tailoring knows about the person (the main CV, other CV versions) and, per job,
// the facts they add. Data and AI match: lib/experience.js (IPC experienceGet / AddCv / Remove / Rematch). Guarded by test/experience-page.test.js.
import {el, pill, tile} from '../components.js';
import {$, message, runWhen} from './core.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One source row: its name and what it adds, then its action. The main CV is the reference and is replaced under CV & details.
export function sourceRow(source) {
  const row = el('li');
  const words = el('div', 'item-words');
  const name = el('b', '', source.name);
  name.append(' ', source.reference ? pill('Reference', 'info') : source.stale ? pill('Needs matching', 'warn', {title: 'Your main CV changed since this version was compared with it'}) : pill(source.added ? `+${plural(source.added, 'detail')}` : 'Nothing new', source.added ? 'good' : 'neutral'));
  words.append(name);
  const meta = source.reference ? `${plural(source.roles, 'job role')}: tailored CVs keep its jobs, titles and dates` : `${plural(source.roles, 'job role')} · added ${runWhen(source.addedAt)}`;
  words.append(el('span', 'muted', meta));
  if (source.onlyHere?.length) words.append(el('span', 'muted', `Only in this version, not added to your CVs: ${source.onlyHere.map(r => [r.title, r.company].filter(Boolean).join(' · ')).join('; ')}`));
  row.append(tile(source.reference ? 'file' : source.kind === 'linkedin' ? 'link' : 'layers', source.reference ? 'info' : 'signal'), words);
  return row;
}

// One job: title, company and period, its bullets; a detail from another version carries where it came from.
export function roleBlock(role) {
  const extras = role.bullets.filter(b => b.from !== 'Main CV').length;
  const box = el('details', 'exp-role');
  const head = el('summary');
  head.append(el('b', '', role.title), el('span', 'muted', ` · ${role.company} · ${role.period}`));
  if (extras) head.append(' ', pill(`+${extras}`, 'good', {title: `${plural(extras, 'detail')} from other CV versions`}));
  const list = el('ul');
  for (const bullet of role.bullets) {
    const item = el('li', '', bullet.text.replace(/\*\*/g, ''));
    if (bullet.from !== 'Main CV') item.append(' ', pill(bullet.from, 'good'));
    list.append(item);
  }
  box.append(head, list);
  return box;
}

export function showExperience(view) {
  const rows = [];
  if (view.main) rows.push(sourceRow({reference: true, name: 'Main CV', roles: view.main.roles}));
  rows.push(...view.sources.map(sourceRow));
  const remove = view.sources.map((source, i) => ({source, row: rows[view.main ? i + 1 : i]}));
  for (const {source, row} of remove) {
    const button = Object.assign(el('button', 'link item-action', 'Remove'), {type: 'button'});
    button.addEventListener('click', async () => {
      button.disabled = true;
      const answer = await window.pilot.experienceRemove(source.id).catch(error => ({ok: false, error: error.message}));
      if (answer.ok) showExperience(answer); else message('exp-message', answer.error || 'Could not remove it.', 'error');
    });
    row.append(button);
  }
  if (view.sources.some(s => s.stale)) {
    const again = Object.assign(el('button', 'secondary item-action', 'Match again'), {type: 'button'});
    again.addEventListener('click', () => run(again, 'Comparing with your main CV…', () => window.pilot.experienceRematch()));
    rows[0]?.append(again);
  }
  $('exp-sources').replaceChildren(...(rows.length ? rows : [el('li', 'muted', 'Read your main CV first (CV & details → Read my CV PDF).')]));
  const extras = view.roles.reduce((n, r) => n + r.bullets.filter(b => b.from !== 'Main CV').length, 0);
  $('exp-count').textContent = view.roles.length ? `${plural(view.roles.length, 'job role')} · ${extras} from other versions` : '';
  $('exp-roles').replaceChildren(...(view.roles.length ? view.roles.map(roleBlock) : [el('p', 'muted', 'Nothing yet: your main CV is read the first time you tailor one, or under CV & details.')]));
  $('exp-add').disabled = $('exp-add-linkedin').disabled = !view.main;
}

async function run(button, working, action) {
  button.classList.add('busy'); button.disabled = true;
  message('exp-message', working);
  const answer = await action().catch(error => ({ok: false, error: error.message}));
  button.classList.remove('busy'); button.disabled = false;
  if (answer.ok) { message('exp-message', answer.sources ? 'Done ✓ Tailored CVs can use it from now on.' : '', 'ok'); showExperience(answer); }
  else message('exp-message', answer.cancelled ? '' : answer.error || 'That did not work.', answer.cancelled ? '' : 'error');
}

export async function loadExperience() {
  message('exp-message', '');
  const view = await window.pilot.experienceGet().catch(() => null);
  if (view) showExperience(view);
}

export function initExperience() {
  $('exp-add-linkedin').addEventListener('click', () => run($('exp-add-linkedin'), 'Reading your LinkedIn data and comparing it with your main CV… (about a minute)', () => window.pilot.experienceAddLinkedin()));
  $('exp-add').addEventListener('click', () => run($('exp-add'), 'Reading the CV and comparing it with your main one… (about a minute)', () => window.pilot.experienceAddCv()));
}

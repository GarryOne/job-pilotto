// Application → Preparation: the job's own cover letter, made with its tailored CV: the text (copy, edit, write again) and its PDF (open).
// Filled from the app (IPC jobLetter); an edit remakes the PDF at once. Guarded by test/job-letter.test.js.
import {el} from '../components.js';
import {copyButton, group} from './parts.js';

const FROM = {kit: 'From your application kit', ai: 'Written for this job', you: 'Edited by you'};

export function jobLetterView(job) {
  const key = job.code || job.url;
  const body = el('div', 'job-letter');
  const draw = async () => {
    const status = await window.pilot.jobLetter(key).catch(() => null);
    body.replaceChildren();
    if (!status?.text) { body.append(el('p', 'muted small', 'No letter yet: Tailor CV + cover letter makes one with the CV.')); return; }
    const note = el('p', 'muted small', `${FROM[status.source] || ''}${status.pdf ? ' · PDF ready' : ''}`);
    const text = Object.assign(el('textarea', 'letter-text'), {value: status.text, rows: 12, hidden: true});
    const shown = el('div', 'letter-shown', '');
    shown.append(...status.text.split(/\n\s*\n/).map(part => el('div', 'iv-moment', part)));
    const message = el('p', 'muted small', '');
    const actions = el('div', 'inline');
    const button = (label, run) => { const node = Object.assign(el('button', 'link', label), {type: 'button'}); node.addEventListener('click', run); return node; };
    const edit = button('Edit', async () => {
      if (text.hidden) { text.hidden = false; shown.hidden = true; edit.textContent = 'Save'; return; }
      edit.textContent = 'Making the PDF…';
      const done = await window.pilot.jobLetterSave(key, text.value);
      if (done.ok) draw(); else { message.textContent = done.error; edit.textContent = 'Save'; }
    });
    const again = button('Write again', async () => {
      again.textContent = 'Writing… (about 20 s)';
      const done = await window.pilot.jobLetterAgain(key);
      if (done.ok) draw(); else { message.textContent = done.error; again.textContent = 'Write again'; }
    });
    actions.append(copyButton(status.text), edit, again);
    if (status.pdf) actions.append(button('Open PDF', () => window.pilot.jobLetterOpen(key)));
    body.append(note, ...status.warnings.map(warning => el('div', 'callout tone-bad', warning)), shown, text, actions, message);
  };
  draw();
  return group('✉️ Tailored cover letter', [body]);
}

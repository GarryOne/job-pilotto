// Documents → Cover letter: the job's own cover letter, made with its tailored CV: the text (copy, edit, write again) and its PDF (open).
// Filled from the app (IPC jobLetter); an edit remakes the PDF at once. One label → value row per fact (rows in documents-rows.js).
// Guarded by test/job-letter.test.js and test/job-documents.test.js.
import {el, pill} from '../components.js';
import {card} from './parts.js';
import {docButton, docCopy, letterPanel, rows} from './documents-rows.js';

const FROM = {kit: 'From your application kit', ai: 'Written for this job', you: 'Edited by you'};
const TITLE = '✉️ Cover letter';

export function jobLetterView(job) {
  const key = job.code || job.url;
  const body = el('div', 'job-letter');
  const draw = async () => {
    const status = await window.pilot.jobLetter(key).catch(() => null);
    body.replaceChildren();
    if (!status?.text) { body.append(rows([['Status', [pill('Not written', 'warn'), 'Tailor CV + cover letter makes one with the CV.']]])); return; }
    const text = Object.assign(el('textarea', 'letter-text'), {value: status.text, rows: 12, hidden: true});
    const shown = letterPanel(status.text);
    const message = el('span', 'muted small', '');
    const edit = docButton('Edit', async () => {
      if (text.hidden) { text.hidden = false; shown.hidden = true; edit.textContent = 'Save'; return; }
      edit.textContent = 'Making the PDF…';
      const done = await window.pilot.jobLetterSave(key, text.value);
      if (done.ok) draw(); else { message.textContent = done.error; edit.textContent = 'Save'; }
    });
    const again = docButton('Write again', async () => {
      again.textContent = 'Writing… (about 20 s)';
      const done = await window.pilot.jobLetterAgain(key);
      if (done.ok) draw(); else { message.textContent = done.error; again.textContent = 'Write again'; }
    });
    const open = status.pdf ? [docButton('Open PDF', () => window.pilot.jobLetterOpen(key))] : [];
    body.append(rows([
      ['Status', [pill(status.pdf ? 'Ready' : 'Text only', status.pdf ? 'good' : 'neutral'), FROM[status.source] || '']],
      ...status.warnings.map(warning => ['Check', [el('span', 'muted', warning)]]),
      ['Text', [shown, text]],
      ['Actions', [docCopy(status.text, 'Copy', true), edit, again, ...open, message]],
    ]));
  };
  draw();
  return card(TITLE, body);
}

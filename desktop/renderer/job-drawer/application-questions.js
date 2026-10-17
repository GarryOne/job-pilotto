// Application → Preparation: the questions only THIS job asked (a motivation essay, "why us", a product quiz), kept out of the global Answer once list
// (owner, 17 Oct 2026). Read from the verdicts kept per question (lib/question-verdicts.js forJob); nothing shown when the job asked none.
// Guarded by test/question-lists.test.js.
import {el} from '../components.js';
import {group} from './parts.js';

export function jobQuestionsView(job) {
  if (!job?.url || !window.pilot?.jobQuestions) return [];
  const box = group('❓ Asked by this job only', []);
  box.hidden = true;
  Promise.resolve(window.pilot.jobQuestions(job.url)).then(list => {
    if (!Array.isArray(list) || !list.length) return;
    box.append(el('p', 'muted small', 'Forms for this job asked these; they are not kept as standard answers.'),
      ...list.map(item => el('div', 'iv-moment', item.question)));
    box.hidden = false;
  }).catch(() => {});
  return [box];
}

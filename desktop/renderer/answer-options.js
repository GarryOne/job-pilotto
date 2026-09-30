// What a "needs you" row can offer as an answer, kept free of the window so a test can check it (session-needs.js
// draws the rows): Claude's proposed answer first, then any answer you saved for the same question, and last the
// escape hatch — "Change with Claude…" — for when neither fits.
import {sameQuestion} from './labels.js';

// Claude's proposed answer: a judgement call's recommendation ("**Recommended:** keep it") or the guess beside a fact
// it couldn't find ("**Suggested:** 8.5/10"). '' when it gave none.
export const proposedAnswer = need => String(need?.recommended || need?.suggested || '').trim();

// The question an answer belongs to: a fact Claude couldn't find asks it, a judgement call names its label ("Pay").
export const askedQuestion = need => String(need?.question || need?.label || '').trim();

// → [{value, label, kind}], kind 'proposed' | 'saved' | 'change'. `saved` is your Answers as Notion holds them
// ({question, answer}): an answer is offered only for the same question (renderer/labels.js), never a guess, and a
// line still waiting for an answer (Notion keeps it as "❓…") is not an answer.
export function answerOptions(need, saved = []) {
  const options = [], answer = proposedAnswer(need), asked = askedQuestion(need);
  if (answer) options.push({value: answer, label: answer, kind: 'proposed'});
  if (asked) {
    for (const entry of saved) {
      const value = String(entry?.answer || '').trim();
      if (!value || value.startsWith('❓') || options.some(option => option.value === value)) continue;
      if (sameQuestion(entry.question, asked)) options.push({value, label: value, kind: 'saved'});
    }
  }
  options.push({value: '', label: 'Change with Claude…', kind: 'change'});
  return options;
}

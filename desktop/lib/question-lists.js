// The three lists of open questions, each through the one shared filter (renderer/question-filter.js): Jobs → Answer once (list), Profile → Needs review
// (verdicts, filtered in the window) and the session's "what Claude needs" (groups). Nothing is deleted; `hidden` is what the filter set aside.
// Guarded by test/question-lists.test.js.
import * as questions from './questions.js';
import * as verdicts from './question-verdicts.js';
import {claudeAi} from './question-ai.js';
import {keyOf, visibleQuestions} from '../renderer/question-filter.js';

const answeredNow = async (storage, groups) => verdicts.answeredOf(storage, groups ?? await questions.standardAnswers(storage));

// Jobs → Answer once: {list: shown (a covered question carries .proposal), hidden: [...], usage}.
export async function openShown(storage, {fetcher, ai = claudeAi(storage), rows = null, groups = null} = {}) {
  const {shown, hidden, usage} = await verdicts.split(storage, rows || await questions.list(storage, fetcher), {answered: await answeredNow(storage, groups), ai});
  return {list: shown, hidden, usage};
}

// Profile → Needs review: the verdict map for these labels (classifying new ones), the window filters with visibleQuestions.
export async function reviewVerdicts(storage, labels, {ai = claudeAi(storage), groups = null} = {}) {
  const {verdicts: map, usage} = await verdicts.ensure(storage, labels, {answered: await answeredNow(storage, groups), ai});
  return {verdicts: Object.fromEntries(labels.map(label => [keyOf(label), map[keyOf(label)]]).filter(([, v]) => v)), usage};
}

// "What Claude needs": the standard answers' groups with the open questions the filter hides left out (cached verdicts only, no AI call here).
export function filterGroups(storage, groups) {
  const known = verdicts.cached(storage);
  return groups.map(group => {
    const open = group.items.filter(item => item.open), {shown} = visibleQuestions(open, known);
    return {...group, items: group.items.filter(item => !item.open || shown.some(each => each.question === item.question))};
  }).filter(group => group.items.length);
}

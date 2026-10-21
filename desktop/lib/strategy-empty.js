// A drafted strategy whose search lists came back empty (no roles, no job board searches: the search cannot run without them) is asked
// again once, naming them, then refused; the Profile and answers are read and corrected by the user on the review. 18 Oct 2026: a fresh
// draft for a Cluj candidate came back after 8 s with no roles, no board searches and "placeholder" as the answers; the search then read
// 2,045 employer sites for 47 minutes and matched nothing. Used by draft() in strategy.js. Tests: desktop/test/strategy-empty.test.js.
import {titlesOf} from './target-roles.js';
export const PARTS = {
  'target roles': draft => titlesOf(draft.search).length > 0,   // one list: the first five are also the job board searches
};

export function emptyParts(draft) {
  return Object.entries(PARTS).filter(([, written]) => !written(draft || {})).map(([name]) => name);
}

export function askAgainNote(parts) {
  return `\n\nYour last answer left ${parts.join(', ')} empty or unwritten. Write every part in full from the CV.`;
}

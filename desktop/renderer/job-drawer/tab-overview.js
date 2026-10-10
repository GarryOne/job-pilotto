// Drawer → Overview: what a person needs first: the summary of why it was scored, the key facts from the posting, and what to check.
// Facts come from the job's match row (job-page-view.js factPairs). Guarded by test/job-drawer.test.js.
import {el} from '../components.js';
import {factPairs, matchView} from '../job-page-view.js';
import {factGrid, group, stateCard} from './parts.js';

export function overviewTab({job, page}) {
  const match = matchView(job, page);
  const facts = factPairs(match);
  const gaps = String(match?.fit_detail?.gaps || '').split(/;\s+/).filter(Boolean);
  const nodes = [];
  if (match?.reason) nodes.push(group('Summary', [match.reason]));
  if (facts.length) { const box = group('Key facts', []); box.append(factGrid(facts)); nodes.push(box); }
  if (gaps.length) nodes.push(group('Points to clarify', gaps.map(text => el('div', 'iv-moment', text))));
  if (!nodes.length) {
    nodes.push(stateCard({title: match ? 'No details saved yet' : 'Not scored yet',
      text: match ? 'The posting\'s facts are saved with the next check of this job.' : 'Its facts, salary and dates are saved when the job is scored.'}));
  }
  return nodes;
}

// Drawer → Review (owner's board 06): the analysis of a rejection or of a completed interview, with a choice between them when there is more
// than one (the rejection's review, then each interview's, newest first). "Reviewed by …" muted on top, the verdict a callout, each section's
// lines a plain list, the to-dos as the interview insights' "Practice next" steps (read-only: the review is a record). None yet: a state card.
import {el} from '../components.js';
import {groupsOf, rejectionOf, reviewsOf} from '../job-page-view.js';
import {card, choice, lineView, stateCard} from './parts.js';

const REVIEWED_BY = /^Reviewed by\b/;
const textOf = line => (typeof line === 'string' ? line : line.text ?? '');
const chosen = new Map();   // job url → a review's key
// The Interviews tab's "View interview review": the next time Review opens for this job, it opens on that one.
export const showReview = (url, key) => chosen.set(url, key);

function reviewSection(title, lines) {
  const todos = lines.filter(line => line.todo !== undefined && line.todo !== null);
  if (todos.length) {   // what to improve: the interview insights' steps
    const block = el('div', 'iv-practice');
    if (title) block.append(el('h3', '', title));
    todos.forEach((line, n) => {
      const row = el('div', `iv-step${line.todo ? ' is-done' : ''}`);
      const words = el('div', 'iv-row-words');
      words.append(el('b', '', line.text));
      const box = Object.assign(el('input', 'iv-step-box'), {type: 'checkbox', checked: !!line.todo, disabled: true});
      row.append(el('span', 'iv-step-n', String(n + 1)), words, box);
      block.append(row);
    });
    return block;
  }
  const box = el('div', 'iv-moments-group');
  if (title) box.append(el('h3', '', title));
  const list = el('ul', 'insight-evidence');
  lines.forEach(line => list.append(line.fold !== undefined ? lineView(line) : el('li', '', textOf(line))));
  box.append(list);
  return box;
}

function reviewBody(groups) {
  const out = [], by = [];
  groups.forEach((part, index) => {
    const lines = part.lines.filter(line => !(REVIEWED_BY.test(textOf(line)) && by.push(textOf(line))));
    let rest = lines;
    if (!part.title && index === 0 && lines.length) {   // the head: the verdict first
      out.push(el('div', 'callout', textOf(lines[0])));
      rest = lines.slice(1);
    }
    // A bold line inside a group is a section's heading ("Evidence", "What to improve next time", "Strengths").
    let section = {title: part.title, lines: []};
    const sections = [section];
    for (const line of rest) {
      if (line.strong) sections.push(section = {title: textOf(line), lines: []});
      else section.lines.push(line);
    }
    out.push(...sections.filter(each => each.lines.length).map(each => reviewSection(each.title, each.lines)));
  });
  return [...by.map(text => el('p', 'muted small', text)), ...out];
}

// The rejection, as the email said it, apart from what the AI makes of it: "Application rejected" with the date and the employer's own words (or that
// the email gave no reason), then a band saying what follows is a suggestion, not a confirmed reason.
function rejectionHead(page) {
  const rejection = rejectionOf(page);
  const nodes = [];
  if (rejection) {
    const quote = rejection.statement
      ? el('blockquote', 'jd-quote', `“${rejection.statement}”`)
      : el('p', '', 'The email does not give a specific reason.');
    nodes.push(stateCard({icon: 'close', tone: 'bad', title: 'Application rejected', text: [rejection.when && `Rejection email received ${rejection.when}`, rejection.from && `from ${rejection.from}`].filter(Boolean).join(' ')}),
      card('Employer statement', quote));
  }
  nodes.push(stateCard({icon: 'bulb', tone: 'info', title: 'AI suggestions', text: 'Suggestions from what Job Pilotto kept, not confirmed rejection reasons.'}));
  return nodes;
}

export function reviewTab({job, page}, redraw) {
  const reviews = reviewsOf(page);
  if (!reviews.length) return [stateCard({icon: 'search', title: 'No review yet', text: 'Available after rejection feedback or a completed interview.'})];
  const active = reviews.find(review => review.key === chosen.get(job.url)) || reviews[0];
  const nodes = [];
  if (reviews.length > 1) nodes.push(choice(reviews.map(review => [review.key, review.label]), active.key, key => { chosen.set(job.url, key); redraw(); }, 'Review of'));
  if (active.key === 'rejection') nodes.push(...rejectionHead(page));
  nodes.push(...reviewBody(groupsOf(active.markdown)));
  return nodes;
}

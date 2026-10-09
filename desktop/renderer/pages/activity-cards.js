// Recent activity: the insight, interview-review, kits and weekly cards.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {cardHead, el, numberStrip, pill} from '../components.js';
import {icon} from '../icons.js';
import {comparisonTable, confidenceLabel, confidenceTone, sourceLine} from '../insight-card.js';
import {$} from './core.js';
import {plural} from './activity-basics.js';
// A daily insight's card: the finding, the numbers behind it, the one action and where it came from (the mockup,
// 30 Sep). Its subtitle, its numbers strip and its labelled evidence groups are drawn only when the insight carries
// them — structured data the AI does not emit yet — so nothing is guessed from the bullets and nothing is left blank.
export function renderInsightCard(insight, target = $('activity-card')) {
  const box = el('div', 'insight-card');
  box.dataset.guidance = 'insight';   // the UI Finder checks its words against who the candidate is
  box.append(cardHead(insight.category, insight.headline, {subtitles: [insight.subtitle],
    badges: insight.confidence ? [pill(confidenceLabel(insight.confidence), confidenceTone(insight.confidence))] : []}));
  if (insight.metrics.length) box.append(numberStrip(insight.metrics));
  // The figures the evidence breaks down the same way, as one comparison (the shared .data-table); those lines leave the evidence.
  const table = comparisonTable(insight.evidence);
  if (table) {
    const grid = el('table', 'data-table');
    const header = el('tr');
    table.columns.forEach((name, i) => header.append(el('th', i === 2 ? 'is-num' : '', name)));
    grid.append(header);
    for (const row of table.rows) {
      const line = el('tr');
      line.append(el('td', '', row.key), el('td', '', row.of), el('td', 'is-num', row.rate));
      grid.append(line);
    }
    box.append(grid);
  }
  const evidence = table ? insight.evidence.filter(line => !table.used.includes(line)) : insight.evidence;
  if (insight.action) {
    const words = el('div', 'insight-next-words');
    words.append(el('b', '', 'Recommended next step'), el('p', '', insight.action));
    const next = el('section', 'insight-next');
    next.append(el('span', 'insight-next-icon', icon('target')), words);
    box.append(next);
  }
  if (evidence.length || insight.groups.length) {
    const why = el('section', 'insight-section');
    why.append(el('h4', '', 'Why this was flagged'));
    if (insight.groups.length) {
      const columns = el('div', 'insight-groups');
      for (const group of insight.groups) {
        const block = el('div', 'insight-group');
        block.append(el('b', '', group.title));
        const list = el('ul', 'insight-evidence');
        group.items.forEach(item => list.append(el('li', '', item)));
        block.append(list);
        columns.append(block);
      }
      why.append(columns);
    } else {
      const list = el('ul', 'insight-evidence');
      evidence.forEach(line => list.append(el('li', '', line)));
      why.append(list);
    }
    box.append(why);
  }
  const source = sourceLine(insight);
  if (source) box.append(el('p', 'insight-source', source));
  target.replaceChildren(box);
}

// An interview review as a card, wearing the insight card's shape (as the weekly report does): the round it was,
// the job, what happened, what was strong and weak, what to practise, and the next step. Every word is the review's.
export function renderInterviewCard(review, target = $('activity-card')) {
  const box = el('div', 'insight-card');
  box.dataset.guidance = 'interview';   // the UI Finder checks its words against who the candidate is
  box.append(cardHead(`Interview · ${review.round}`, review.title || 'Interview review', {subtitles: [review.summary]}));
  for (const section of review.sections) {
    const node = el('section', 'insight-section');
    node.append(el('h4', '', `${section.icon} ${section.label}`.trim()));
    if (section.items.length) {
      const list = el('ul', 'insight-evidence');
      section.items.forEach(item => list.append(el('li', '', item)));
      node.append(list);
    }
    box.append(node);
  }
  if (review.next || review.stage) {
    const words = el('div', 'insight-next-words');
    words.append(el('b', '', review.next ? 'Next' : 'Stage'), el('p', '', review.next || review.stage));
    if (review.next && review.stage) words.append(el('p', 'insight-subtitle', review.stage));
    const next = el('section', 'insight-next');
    next.append(el('span', 'insight-next-icon', icon('target')), words);
    box.append(next);
  }
  target.replaceChildren(box);
}

// The kits a "Prepare top matches" run drafted, on the insight card's shape: the count, then one row per job with its
// title (linked to the posting) and company. Every word is the run's own.
export function renderKitsCard(kits, target = $('activity-card')) {
  const box = el('div', 'insight-card');
  const cvs = kits.what === 'cv';
  // Some failed: the heading says how many of how many; the jobs that failed get a row each, as their log lines name them.
  const {done = kits.jobs.length, total = kits.jobs.length, failed = []} = kits.outcome || {};
  const noun = cvs ? 'CV' : 'kit';
  const head = cardHead(cvs ? 'Tailored CVs' : 'Application kits', total > done ? `${done} of ${plural(total, noun)} ready` : `${plural(kits.jobs.length, noun)} ready`,
    {subtitles: [total > done ? `${plural(total - done, noun)} could not be ${cvs ? 'tailored' : 'drafted'}${failed.length ? '.' : ': the run did not record which.'}`
      : kits.subtitle]});   // partial: the line above says it, with the counts
  // One row per job (the shared .item-rows): its title (the posting opens from it) and company, then the one action, aligned.
  const list = el('ul', 'item-rows kits-jobs');
  for (const job of kits.jobs) {
    const row = el('li', '');
    const words = el('div', 'item-words');
    const title = el('a', 'link', job.title);
    title.href = job.url; title.target = '_blank'; title.rel = 'noopener';
    title.title = 'Open the job posting';
    const name = el('b', '');
    name.append(title);
    words.append(name, ...(job.company ? [el('span', 'muted', job.company)] : []));
    row.append(words);
    if (cvs) {   // the tailored CV itself, as the Jobs list's 📄 Tailored CV opens it
      const view = el('button', 'secondary item-action', 'View CV');
      view.type = 'button';
      view.title = 'Your CV tailored to this job, with the changes highlighted';
      view.append(icon('external'));
      view.addEventListener('click', () => window.pilot.openTailoredCv(job.url));
      row.append(view);
    }
    list.append(row);
  }
  for (const job of failed) {   // a job that failed: no CV of this run to open, so no action; its reason on hover
    const row = el('li', 'is-failed');
    const words = el('div', 'item-words');
    words.append(el('b', '', job.title), el('span', 'muted', job.company));
    const tag = pill(cvs ? 'Not tailored' : 'Not drafted', 'warn');
    if (job.reason) tag.title = job.reason;
    row.append(words, tag);
    list.append(row);
  }
  box.append(head, list);
  target.replaceChildren(box);
}

// The week's report as a card, wearing the insight card's shape: the headline sentence, the paragraph under it, the
// one focus to carry into next week on the same warm band, then what worked and what to change. A report without a
// focus, or without worked items, simply has no such block, and its lists are drawn only when they have something in
// them. The report's confidence and its recurring-evidence priorities sit on the Notion page, not in this message.
export function renderWeeklyCard(weekly, target = $('activity-card')) {
  target.replaceChildren(weeklyCard(weekly));
}

// The weekly report's card itself (Recent activity draws it; Reports → Weekly adds the report's other sections under it).
export function weeklyCard(weekly) {
  const box = el('div', 'insight-card');
  box.dataset.guidance = 'weekly';   // the UI Finder checks its words against who the candidate is
  box.append(cardHead('Search analysis · last 7 days', weekly.headline, {subtitles: [weekly.finding && `💡 ${weekly.finding}`, weekly.summary]}));
  if (weekly.focus) {
    const words = el('div', 'insight-next-words');
    words.append(el('b', '', 'Focus next'), el('p', '', weekly.focus));
    const focus = el('section', 'insight-next');
    focus.append(el('span', 'insight-next-icon', icon('target')), words);
    box.append(focus);
  }
  for (const [title, items] of [['What worked', weekly.worked], ['Change next week', weekly.change]]) {
    if (!items.length) continue;
    const section = el('section', 'insight-section');
    section.append(el('h4', '', title));
    const list = el('ul', 'insight-evidence');
    items.forEach(item => list.append(el('li', '', item)));
    section.append(list);
    box.append(section);
  }
  return box;
}


// An interview's review in the app (Interviews → Open review), for a store with no page to open (the data on this Mac): the same content as
// the Notion page (src/ai/interviews.py): round, overall, the counts, the next step, answers and topics to work on, the review, the transcript.
// reviewParts() is pure (test/interview-review-view.test.js); showReview() draws it in #review-dialog with the moments dialog's parts
// (`el`, `pill` and `$` from the page, so this file loads without a window). markdownGroups keeps its name and shape: pages/job-panel.js uses it.
const list = value => (Array.isArray(value) ? value : String(value || '').split('\n')).map(line => String(line).replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean);

// Markdown the review is kept in → groups: a heading starts one, bullets and paragraphs are its lines. Text only, never HTML.
export function markdownGroups(text, first = 'Review') {
  const groups = [];
  let group = null;
  for (const raw of String(text || '').split('\n')) {
    const heading = /^#{1,4}\s+(.*)$/.exec(raw.trim());
    if (heading) { group = {title: heading[1].trim(), lines: []}; groups.push(group); continue; }
    const line = raw.trim().replace(/^[-*•]\s+|^\d+[.)]\s+/, '');
    if (!line) continue;
    if (!group) { group = {title: first, lines: []}; groups.push(group); }
    group.lines.push(line);
  }
  return groups;
}

// The review's two structured sections, as src/ai/interviews_blocks.py writes them (fixed markers of our own engine, not words of the
// person): "Questions" lines `<mark> [topic] question — answer → Better: …` and "Facts from the call" lines ending in "(added to the job)"
// or "⚠️ Different from the job (it says “…”): …" (src/ai/interviews_facts.py fact_lines). A line that doesn't parse is kept as it is.
export const QUESTIONS = 'Questions', CALL_FACTS = 'Facts from the call';
export const VERDICTS = {'✅': ['Strong', 'good'], '➖': ['OK', 'neutral'], '⚠️': ['Weak', 'warn'], '❌': ['Not answered', 'bad']};
export function questionOf(line) {
  // The store's Markdown escapes the topic's bracket (`\[On-call]`, src/stores/notion_blocks.py); an unanswered question ends in "— ".
  const found = /^(✅|➖|⚠️|❌)?\s*(?:\\?\[([^\]]*)\]\s*)?(.*)$/u.exec(String(line).trim());
  const [, mark = '', topic = '', rest = ''] = found;
  const [asked, better = ''] = rest.split(/\s*→ Better:\s*/);
  const [question, ...answer] = asked.split(/\s+—(?:\s+|$)/);
  const [verdict, tone] = VERDICTS[mark] || ['', 'neutral'];
  return {verdict, tone, topic: topic.trim(), question: question.trim(), answer: answer.join(' — ').trim(), better: better.trim()};
}
export function callFactOf(line) {
  const differs = /\s*⚠️ Different from the job \(it says “([^”]*)”\).*$/u.exec(line);
  if (differs) return {text: line.slice(0, differs.index).trim(), mark: 'differs', current: differs[1]};
  if (/\s*\(added to the job\)$/.test(line)) return {text: line.replace(/\s*\(added to the job\)$/, '').trim(), mark: 'added', current: ''};
  return {text: line, mark: '', current: ''};
}

// {title, facts, groups: [{title, lines}], questions: [questionOf], callFacts: [callFactOf], transcript: [lines]}
// questions and callFacts are drawn in their own sections, so their groups are left out of `groups`.
export function reviewParts(record = {}) {
  const facts = [record.round, record.overall && `Overall: ${record.overall}`, record.questions && `${record.questions} questions`,
    record.at && String(record.at).slice(0, 10)].filter(Boolean).join(' · ');
  const groups = [
    {title: 'Next step', lines: list(record.next_step)},
    {title: 'Answers to work on', lines: list(record.weak_answers)},
    {title: 'Topics to work on', lines: list(record.weak_topics)},
    {title: 'Topics', lines: list(record.topics)},
    ...markdownGroups(record.review),
  ].filter(group => group.lines.length);
  const take = title => groups.filter(group => group.title === title).flatMap(group => group.lines);
  return {title: record.title || 'Interview review', facts, groups: groups.filter(group => ![QUESTIONS, CALL_FACTS].includes(group.title)),
    questions: take(QUESTIONS).map(questionOf), callFacts: take(CALL_FACTS).map(callFactOf), transcript: list(record.transcript)};
}

// A pill as components.js draws it (passed in like `el`, so this file loads without a window).
const FACT_MARKS = {added: ['Added to the job', 'good'], differs: ['Different from the job', 'warn']};
function questionRow(q, {el, pill}) {
  const row = el('div', 'iv-moment');
  const head = el('div', '');
  if (q.verdict) head.append(pill(q.verdict, q.tone), ' ');
  if (q.topic) head.append(el('span', 'muted small', `${q.topic} · `));
  head.append(el('b', '', q.question));
  row.append(head);
  if (q.answer) row.append(el('div', '', `You: ${q.answer}`));
  if (q.better) row.append(el('div', 'muted small', `Better: ${q.better}`));
  return row;
}
function callFactRow(fact, {el, pill}) {
  const row = el('div', 'iv-moment');
  const head = el('div', '');
  head.append(el('span', '', fact.text));
  if (fact.mark) head.append(' ', pill(...FACT_MARKS[fact.mark]));
  row.append(head);
  if (fact.mark === 'differs') row.append(el('div', 'muted small', `The job says “${fact.current}”. Not changed: update the job if the call is right.`));
  return row;
}
const section = (title, rows, {el}) => { const box = el('div', 'iv-moments-group'); box.append(el('h3', '', title), ...rows); return box; };

export function showReview(record, {$, el, pill}) {
  const parts = reviewParts(record);
  $('review-title').textContent = parts.title;
  $('review-facts').textContent = parts.facts;
  const groups = parts.groups.map(group => {
    const box = el('div', 'iv-moments-group');
    box.append(el('h3', '', group.title), ...group.lines.map(line => el('div', 'iv-moment', line)));
    return box;
  });
  // In the page's order: the facts from the call before the practice list, every question at the end (src/ai/interviews_blocks.py).
  if (parts.callFacts.length) {
    const facts = section(CALL_FACTS, parts.callFacts.map(fact => callFactRow(fact, {el, pill})), {el});
    const practise = parts.groups.findIndex(group => group.title === 'Practise before the next round');
    groups.splice(practise < 0 ? groups.length : practise, 0, facts);
  }
  if (parts.questions.length) groups.push(section(QUESTIONS, parts.questions.map(q => questionRow(q, {el, pill})), {el}));
  const transcript = el('details', 'troubleshoot');
  transcript.append(el('summary', '', `Transcript · ${parts.transcript.length} lines`), ...parts.transcript.map(line => el('p', 'small', line)));
  $('review-body').replaceChildren(...(groups.length ? groups : [el('p', 'muted', 'No review yet: press Review on the interview.')]),
    ...(parts.transcript.length ? [transcript] : []));
  $('review-dialog').showModal();
}

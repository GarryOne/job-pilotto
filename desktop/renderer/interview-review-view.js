// An interview's review in the app (Interviews → Open review), for a store with no page to open (the data on this Mac): the same content as
// the Notion page (src/ai/interviews.py): round, overall, the counts, the next step, answers and topics to work on, the review, the transcript.
// reviewParts() is pure (test/interview-review-view.test.js); showReview() draws it in #review-dialog with the moments dialog's parts
// (`el` and `$` from the page, so this file loads without a window).
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

// {title, facts, groups: [{title, lines}], transcript: [lines]}
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
  return {title: record.title || 'Interview review', facts, groups, transcript: list(record.transcript)};
}

export function showReview(record, {$, el}) {
  const parts = reviewParts(record);
  $('review-title').textContent = parts.title;
  $('review-facts').textContent = parts.facts;
  const groups = parts.groups.map(group => {
    const box = el('div', 'iv-moments-group');
    box.append(el('h3', '', group.title), ...group.lines.map(line => el('div', 'iv-moment', line)));
    return box;
  });
  const transcript = el('details', 'troubleshoot');
  transcript.append(el('summary', '', `Transcript · ${parts.transcript.length} lines`), ...parts.transcript.map(line => el('p', 'small', line)));
  $('review-body').replaceChildren(...(groups.length ? groups : [el('p', 'muted', 'No review yet: press Review on the interview.')]),
    ...(parts.transcript.length ? [transcript] : []));
  $('review-dialog').showModal();
}

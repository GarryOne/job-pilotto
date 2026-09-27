// "Answer once": required form questions that a fill couldn't answer from the kit, the Profile, the standard
// answers or your details. The app lists them; each answer is added to the Notion standard answers page, so
// every later kit (and fill) has it. Kept in settings.json until answered or dismissed.
export const NO_ANSWER = 'no answer in the kit, Profile or your details';
export const key = question => String(question || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function collect(storage, run, company = '') {
  const open = storage.settings().openQuestions || [];
  const known = new Set([...open.map(q => q.key), ...(storage.settings().answeredQuestions || [])]);
  let added = 0;
  for (const field of run.trace || []) {
    if (!field.required || field.reason !== NO_ANSWER) continue;
    const k = key(field.label);
    if (!k || known.has(k)) continue;
    open.push({key: k, question: field.label, company, url: run.url, at: new Date().toISOString()});
    known.add(k);
    added += 1;
  }
  if (added) storage.saveSettings({openQuestions: open});
  return added;
}

export function close(storage, questionKey, answered) {
  const settings = storage.settings();
  storage.saveSettings({
    openQuestions: (settings.openQuestions || []).filter(q => q.key !== questionKey),
    // Answered ones are remembered so a later fill doesn't ask again before its kit is redrafted.
    answeredQuestions: answered ? [...new Set([...(settings.answeredQuestions || []), questionKey])] : settings.answeredQuestions || [],
  });
}

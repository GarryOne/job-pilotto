// The facts of Your details that have a value (contact lines and the three sections), as [{label, value}]: what a form question can be answered from
// (owner, 17 Oct 2026: base facts are never asked again). The AI sees the labels only (lib/question-reuse.js); a fact with no value is not listed, so
// a question about it is still asked. Guarded by test/question-base-facts.test.js.
import * as contact from './contact.js';
import * as sections from './profile-sections.js';

export async function factsOf(storage, fetcher) {
  const [details, extra] = await Promise.all([contact.read(storage, fetcher).catch(() => ({})), sections.read(storage, fetcher).catch(() => ({}))]);
  const own = Object.entries(contact.LABELS).filter(([key]) => details[key]).map(([key, label]) => ({label, value: details[key]}));
  return [...own, ...Object.values(extra).flat().filter(item => item.value)].filter((item, at, all) => all.findIndex(each => each.label === item.label) === at);
}

// "No answer", split by what the fill card's meaning words say (Missing answers, 15 Oct 2026): suggested and waiting for the person, left on purpose, a true gap; each with
// its count and its top meanings. Built from fill_cards.gaps ("meaning:cause:design|gap" counts, extension/fill-meaning.js), for real use and the pool apart. Shown inside the
// "Why fields were left empty" section (src/left-empty.js). Guarded by site/test/left-empty.test.js: a meaning word without a title fails there.
import {MEANINGS} from '../../extension/fill-meaning.js';
import {esc} from './stats.js';

export const BUCKETS = [
  {key: 'suggested', title: 'Suggested, waiting for the person', note: 'the AI proposed an answer and the app did not type it (a knockout, a contact detail or a low-confidence guess)'},
  {key: 'purpose', title: 'Left on purpose', note: 'consent and legal, own words, demographic, a password, a file the person gives'},
  {key: 'gap', title: 'True gap', note: 'no saved fact, or the AI gave no answer or was unsure: ours to close'},
];
// Every meaning word -> the words the page shows.
export const MEANING_TITLE = {work_permit: 'work permit', sponsorship: 'sponsorship', home_location: 'home place', relocation: 'relocation', work_mode: 'work mode', languages: 'languages',
  salary: 'salary', notice_period: 'notice period', start_date: 'start date', years_experience: 'years of experience', employment_history: 'employment history', education: 'education',
  links: 'links', referral_source: 'how they heard', employee_of_this_company: 'worked here before', relatives_at_this_company: 'knows someone here', contact: 'contact detail',
  legal: 'consent / legal', demographic: 'demographic', written: 'own words', password: 'password', file: 'file', unread: 'question not read', other: 'other', unknown: 'meaning not known'};

export const bucketOf = key => { const [, cause, design] = String(key).split(':'); return cause === 'proposed' ? 'suggested' : design === 'design' ? 'purpose' : 'gap'; };

// {"meaning:cause:design": n} -> {total, buckets: [{key, title, note, count, share, meanings: [{meaning, title, count}]}]}
export function splitGaps(counts) {
  const entries = Object.entries(counts || {}).map(([key, n]) => [key, Number(n) || 0]).filter(([key, n]) => n > 0 && MEANINGS.includes(key.split(':')[0]));
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return {total, buckets: BUCKETS.map(bucket => {
    const by = {};
    for (const [key, n] of entries) if (bucketOf(key) === bucket.key) by[key.split(':')[0]] = (by[key.split(':')[0]] || 0) + n;
    const meanings = Object.entries(by).map(([meaning, count]) => ({meaning, title: MEANING_TITLE[meaning] || meaning, count})).sort((a, b) => b.count - a.count || a.meaning.localeCompare(b.meaning));
    const count = meanings.reduce((sum, item) => sum + item.count, 0);
    return {...bucket, count, share: total ? count / total : null, meanings};
  })};
}

const pct = value => (value == null ? '–' : `${Math.round(value * 100)}%`);
// The sub-table under the four groups; thin: real use under 3 installs (counts muted, no share, as the table above).
export function gapsTable(split, thin) {
  if (!split?.total) return '<p class="muted">No meaning words yet: older apps do not send them.</p>';
  return `<h3>What the unanswered fields were about</h3><small class="muted">Fixed meaning words from the fill card; a field can be counted here and not above (consent, own-words and demographic fields are counted here only).</small>
<div class="wrap"><table><tr><th>Bucket</th><th class="n">Fields</th><th class="n">Share</th><th>Top meanings</th></tr>
${split.buckets.map(bucket => `<tr${thin ? ' class="muted"' : ''}><td>${esc(bucket.title)}<br><small class="muted">${esc(bucket.note)}</small></td><td class="n">${bucket.count}</td><td class="n">${thin ? '–' : pct(bucket.share)}</td>
<td>${bucket.meanings.slice(0, 6).map(item => `${esc(item.title)} <span class="muted">${item.count}</span>`).join(' · ') || '<span class="muted">none</span>'}</td></tr>`).join('\n')}</table></div>`;
}

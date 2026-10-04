// The verdict pass's measured accuracy (5 Oct 2026): "every verdict I checked was right" is not a number. Each week, five random verdicts of the last 7 days (on issues,
// and the ones that kept a finding from being filed) go into one issue with a right / wrong box each; the owner ticks them, and the next audit reports the score. Pure.
import {MARK, whyOf} from './verdict-comment.mjs';

export const AUDIT_LABEL = 'verdict-audit';
export const AUDIT_SIZE = 5;

// -> [{key, word, what, why, where}] judged in the window; `pick` is the random source (tests pass a fixed one).
export function sampleVerdicts({issues = [], register = [], now = Date.now(), days = 7, n = AUDIT_SIZE, pick = Math.random}) {
  const since = now - days * 86400000, pool = [];
  for (const issue of issues) for (const comment of issue.comments || []) {
    const word = MARK.exec(String(comment.body || ''))?.[1];
    if (word && Date.parse(comment.createdAt || 0) >= since) pool.push({key: `i${issue.number}`, word, what: String(issue.title || '').replace(/^\[auto-ui\] /, ''), why: whyOf(comment.body).slice(0, 300), where: `#${issue.number}`});
  }
  for (const item of register) if (Date.parse(item.date || 0) >= since - 86400000) pool.push({key: `r${item.id}`, word: item.word, what: `${item.view}: ${item.title}`, why: String(item.why || '').slice(0, 300), where: 'not filed (noise register)'});
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(pick() * pool.length), 1)[0]);
  return out;
}

export function auditBody(items, last = null) {
  return [`**Was the verdict right?** Tick one box per verdict. Five random verdicts of the last 7 days; the next audit reads your ticks and reports the accuracy.`,
    ...(last ? ['', `📏 **Last audit:** ${last.right} of ${last.right + last.wrong} right${last.right + last.wrong < last.size ? ` (${last.size - last.right - last.wrong} not ticked)` : ''}.`] : []), '',
    ...items.flatMap((item, i) => [`### ${i + 1}. \`${item.word}\` · ${item.what.slice(0, 90)} (${item.where})`, `> ${item.why.replace(/\n/g, ' ')}`, '',
      `- [ ] 👍 right <!-- audit:${item.key}:right -->`, `- [ ] 👎 wrong <!-- audit:${item.key}:wrong -->`, '']),
    '<sub>Written by `desktop/e2e/verdict-audit.mjs` every Saturday. Tick the boxes; do not edit the rest.</sub>'].join('\n');
}

// The owner's ticks: -> {right, wrong, size}.
export function auditScore(body) {
  const text = String(body || '');
  const ticked = kind => (text.match(new RegExp(`- \\[[xX]\\] [^\\n]*<!-- audit:[^:]+:${kind} -->`, 'g')) || []).length;
  return {right: ticked('right'), wrong: ticked('wrong'), size: (text.match(/<!-- audit:[^:]+:right -->/g) || []).length};
}

// Learning from the owner's corrections (5 Oct 2026). When a person REVERSES the loop's judgement (reopens an issue it closed as noise, removes `confirmed`,
// or closes a confirmed issue as not planned), that case is a lesson the judge did not have: it is given to the verdict pass, the judgement before filing and
// the weekly self-review as an example, with the person's own words. Only people count: the loop's own label and close events are not corrections. Pure.
import {whyOf} from './verdict-comment.mjs';

const BOT = /\[bot\]$|^github-actions$/;
const person = event => event.actor?.login && !BOT.test(event.actor.login);
const has = (issue, name) => (issue?.labels || []).some(item => (item.name || item) === name);

// events: GitHub's repository issue events (newest first or not). issues: {number: issue with comments} to read the person's words. -> [{number, title, was, now, words, at}]
export function reversalsFrom(events, issues = {}) {
  const seen = new Set(), out = [];
  for (const event of [...events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    if (!person(event) || !event.issue || !has(event.issue, 'auto-ui')) continue;
    let was = '', now = '';
    if (event.event === 'reopened' && has(event.issue, 'wontfix-auto')) { was = 'judged noise (false positive or test problem) and closed'; now = 'a person reopened it: it was real'; }
    else if (event.event === 'unlabeled' && event.label?.name === 'confirmed') { was = 'judged real (confirmed)'; now = 'a person removed confirmed: it was not worth a fix'; }
    else if (event.event === 'closed' && event.issue.state_reason === 'not_planned' && has(event.issue, 'confirmed')) { was = 'judged real (confirmed)'; now = 'a person closed it as not planned'; }
    else continue;
    if (seen.has(event.issue.number)) continue;
    seen.add(event.issue.number);
    const full = issues[event.issue.number] || event.issue;
    const said = (Array.isArray(full.comments) ? full.comments : []).filter(   // an event's own issue carries a comment COUNT, not the comments
      comment => comment.author && !BOT.test(comment.author.login || '') && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.authorAssociation)).at(-1);
    out.push({number: event.issue.number, title: String(event.issue.title || '').replace(/^\[auto-ui\] /, '').slice(0, 100), was, now, words: said ? whyOf(said.body).replace(/\s+/g, ' ').slice(0, 300) : '', at: event.created_at});
  }
  return out;
}

// The block every judge reads: the newest corrections first, at most `max`. Empty when there are none.
export function lessonsBlock(list, max = 10) {
  if (!list.length) return '';
  return ['', '---', 'PAST VERDICTS A PERSON CORRECTED (the owner knows the product: when a case below is like the one you judge, decide the way the person did):',
    ...list.slice(0, max).map(item => `- #${item.number} "${item.title}": the loop ${item.was}; ${item.now}.${item.words ? ` Their words: "${item.words}"` : ''}`), ''].join('\n');
}

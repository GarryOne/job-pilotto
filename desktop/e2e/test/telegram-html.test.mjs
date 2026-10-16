// The one formatter for every alert message (lib/telegram-html.mjs, used by ci-alert.mjs and the Sentry bot): shape, escaping, links, size. A test loops over every kind the CI bot sends.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LIMIT, alertHtml, esc, link} from '../lib/telegram-html.mjs';
import {messageOf} from '../ci-alert.mjs';

const env = {GITHUB_WORKFLOW: 'CI · E2E', GITHUB_SHA: 'abcdef1234', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42', GITHUB_SERVER_URL: 'https://github.com'};
const now = new Date('2026-10-16T09:00:00Z');
const since = {prs: ['958', '956'], more: 4}, jobs = [{name: 'plan', url: 'https://github.com/o/r/actions/runs/42/job/7'}];

// Every kind of message the CI alerts bot sends (the call sites in .github/workflows: e2e, site replays x2, refill, nightly gate, back to green).
const KINDS = {
  'e2e failed': {status: 'failure', what: 'Failed job: plan', next: 'Open the failed job; the next scheduled run re-checks', since, jobs},
  'site replays: rows worse': {status: 'failure', what: 'Pinned rows no longer same as live: Join: reached posting; Lever: <b>typed</b> & more', next: 'If intended: label the PR replay-accepted + comment Replay-accept: <reason>', since},
  'site replays broke': {status: 'failure', what: 'The replay job broke before its verdict', next: 'Open the run', since: {prs: [], more: 0}},
  'refill failed': {status: 'failure', what: 'The replay refill on main did not finish (pick=success refill=failure)', next: 'Run it again: gh workflow run replay-refill.yml (no pr)', since},
  'nightly gate': {status: 'failure', what: 'No nightly beta: fail: 2 rows worse', next: 'The nightly builds again once the offline replay is green'},
  'back to green': {status: 'success', previous: 'failure'},
  'a very long cause': {status: 'failure', what: 'x '.repeat(3000), next: 'y '.repeat(3000), since, jobs},
};

test('every kind: status emoji + bold workflow first, a blank line, bullets, named links only, escaped, under the limit, no preview', () => {
  for (const [kind, input] of Object.entries(KINDS)) {
    const message = messageOf({...input, env, now});
    const {text} = message;
    assert.equal(message.parse_mode, 'HTML', kind);
    assert.equal(message.link_preview_options.is_disabled, true, kind);
    assert.match(text, /^(🔴|🟢) <b>CI · E2E<\/b> (failed|is back to green)\n\n• /, kind);
    assert.match(text, /\n\n<a href="https:\/\/github\.com\/o\/r\/actions\/runs\/42">Open run<\/a>/, kind);
    assert.ok(text.length <= LIMIT, `${kind}: ${text.length} characters`);
    assert.doesNotMatch(text.replace(/<a href="[^"]*">/g, '<a>'), /https?:\/\//, `${kind}: a bare URL`);
    const tags = text.match(/<\/?[a-z]+/g) || [];
    for (const tag of ['b', 'a']) assert.equal(tags.filter(one => one === `<${tag}`).length, tags.filter(one => one === `</${tag}`).length, `${kind}: <${tag}> balanced`);
    assert.doesNotMatch(text.replace(/<\/?(b|a)( href="[^"]*")?>/g, ''), /[<>]/, `${kind}: every other < and > is escaped`);
  }
  assert.match(messageOf({...KINDS['site replays: rows worse'], env, now}).text, /&lt;reason&gt;/);
  assert.equal(messageOf({status: 'success', previous: 'success', env, now}), '', 'a success after a success says nothing');
});

test('escaping, links and the size limit of the formatter itself', () => {
  assert.equal(esc('a<b>&"c'), 'a&lt;b&gt;&amp;"c');
  assert.equal(link('x', 'javascript:alert(1)'), 'x', 'only http(s) links');
  assert.equal(link('a<b', 'https://e.test/?a=1&b=2'), '<a href="https://e.test/?a=1&amp;b=2">a&lt;b</a>');
  assert.equal(link('x', 'https://e.test/"onclick'), 'x', 'a quote in an address is never put in an attribute');
  const huge = alertHtml({icon: '🔴', title: 'T', verdict: 'v', bullets: [{label: 'Cause', parts: ['word '.repeat(2000)]}, {label: 'Next', parts: ['n '.repeat(2000)]}], links: [{text: 'Open run', url: 'https://e.test/r'}]});
  assert.ok(huge.text.length <= LIMIT);
  assert.match(huge.text, /<a href="https:\/\/e\.test\/r">Open run<\/a>$/, 'the links survive the shortening');
  // a Sentry-style message: bold title, bullets, one named link
  const sentry = alertHtml({icon: '🚨', title: 'New production error:', verdict: 'TypeError <x>', bullets: [{label: 'Events', parts: ['12']}, {label: 'Release', parts: ['0.9.540']}], links: [{text: 'Open in Sentry', url: 'https://sentry.io/i/1'}]});
  assert.equal(sentry.text, '🚨 <b>New production error:</b> TypeError &lt;x&gt;\n\n• Events: 12\n• Release: 0.9.540\n\n<a href="https://sentry.io/i/1">Open in Sentry</a>');
});

// One status per pool row (site/src/applying-status.js rowStatus): every view of a row reads it, so a hold is never drawn as "not working" (owner, 14 Oct 2026).
// One test loops over every view x every status through the real ingest, data() and the page's own script on a tiny DOM. Guard for the Fixed tab's clean runs too.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';
import {statusOf} from '../src/applying-fixed.js';
import {STATES, STATE_WORD, isCleanHold, rowStatus} from '../src/applying-status.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');
// Made-up rows, one per status (and one per hold rule): [name, state it must have, the run].
const ROWS = [
  ['Works one', 'works', {reached: 'ready', filled: 9, left: 0}],
  ['Held account', 'held', {reached: 'account', note: 'account-first: held'}],
  ['Held eligibility', 'held', {reached: 'form', note: 'eligibility stop: the role is elsewhere'}],
  ['Held wall', 'held', {reached: 'posting', note: 'login wall: held'}],
  ['Held email', 'held', {reached: 'posting', note: 'applies by email: told'}],
  ['Held tells', 'held', {reached: 'posting', note: 'page tells how to apply: told'}],
  ['Held bot', 'held', {reached: 'code/bot'}],
  ['Held closed', 'held', {reached: 'posting', note: 'posting closed: held'}],
  ['Site refused', 'site', {reached: 'posting', note: 'site refused: retry later'}],
  ['Site CI blocked', 'site', {reached: 'posting', note: 'blocked in CI: needs a Mac recording'}],
  ['Site gone', 'site', {reached: 'none', note: 'posting gone (HTTP 404)'}],
  ['Fix early', 'fix', {reached: 'posting', rung: 2, signal: 'failed'}],
  ['Fix regression', 'fix', {reached: 'form', filled: 9, left: 0, regression: true}],
  ['Fix short', 'fix', {reached: 'form', filled: 5, left: 12, asked: 17, unexplained: 6}],
  // Fewer filled than the last run, but every empty asked field is left by a rule (proposed, written, a consent, a password): not a fix (owner, 14 Oct 2026; a pool row
  // whose location moved from typed to proposed read red). One field of ours unexplained keeps it red.
  ['Works rule holds', 'works', {reached: 'form', filled: 8, left: 4, regression: true, asked: 7, unexplained: 0}],
  ['Fix one of ours', 'fix', {reached: 'form', filled: 12, left: 8, regression: true, asked: 14, unexplained: 1}],
  ['Fix regression, old run', 'fix', {reached: 'form', filled: 7, left: 2, regression: true}],
];

test('rowStatus: works, held on purpose (says which rule), site problem, needs a fix, not run', () => {
  assert.deepEqual(ROWS.map(([, , run]) => rowStatus({...run, short: run.unexplained ? {unexplained: run.unexplained} : null}).state), ROWS.map(row => row[1]));
  assert.deepEqual(rowStatus({}), {state: 'unrun', rule: ''});
  assert.equal(rowStatus({reached: 'form', note: 'account-first: held'}).rule, 'account-first');
  assert.deepEqual(STATES, Object.keys(STATE_WORD));
});

test('every view of a row reads its one status: Result, Rung, run dots, By-hand runs, tiles, Needs a fix', async () => {
  const db = d1();
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: [...ROWS.map(([name]) => ({name, start_host: 'x.example'})), {name: 'Never run', start_host: 'x.example'}]}, now);
  for (const [name, , run] of ROWS) await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name, host: 'x.example', ...run}]}, now);
  const json = JSON.parse(JSON.stringify(await data(db, now))), by = Object.fromEntries(json.pool.map(row => [row.shape, row]));
  // data(): the row, its dots and the bars
  for (const [name, state] of ROWS.map(([n, s]) => [n, s]).concat([['Never run', 'unrun']])) {
    assert.equal(by[name].status.state, state, name + ' row');
    if (state !== 'unrun') assert.equal(by[name].states.at(-1).state, state, name + ' dot');
  }
  const total = ROWS.length, counts = json.nights[0].counts;
  assert.deepEqual(Object.keys(counts), STATES);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), total, 'a bar holds every run');
  assert.deepEqual([counts.works, counts.held, counts.site, counts.fix], [2, 7, 3, 5]);
  assert.deepEqual([json.tiles.needFix, json.tiles.held, json.tiles.gone], [5, 7, 3]);
  // the page: its own script on a tiny DOM
  const script = PAGE.split('<script>')[1].split('</script>')[0];
  const make = tag => ({tag, children: [], hidden: false, style: {}, set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
    append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); },
    text() { return this.children.map(kid => (typeof kid === 'string' ? kid : kid.text())).join('|'); }});
  const app = make('div'), document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', script)(document, async () => ({json: async () => json}), () => ({}), {escape: x => x}, () => 0, Object);
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = app.text(), needs = text.slice(text.indexOf('Needs a fix · where applying stops'), text.indexOf('By cause · what to fix first'));
  for (const [name, state] of ROWS.map(([n, s]) => [n, s])) {
    assert.equal(needs.includes(name), state === 'fix', name + ' on Needs a fix only when it needs a fix');
  }
  // the pool table draws page 1 (15 rows): find each row's cells
  const poolText = text.slice(text.indexOf('The pool · every smoke site'));
  for (const state of STATES) assert.ok(PAGE.includes('d.stateWords[') && Object.values(STATE_WORD).includes(STATE_WORD[state]), state + ' has a word');
  assert.ok(poolText.includes(STATE_WORD.held) && poolText.includes(STATE_WORD.works) && poolText.includes(STATE_WORD.site), 'the Result column says the status');
  assert.ok(!/Blocked\|[^|]*\|[^|]*Held on purpose/.test(poolText));
  // the Rung column: Blocked only for a row that needs a fix; the dots never colour a hold red
  assert.ok(PAGE.includes("s.status.state === 'fix' && !['form', 'ready'].includes(s.reached) && s.rung != null"), 'blocked is a status of its own');
  assert.ok(PAGE.includes("className: (step.state ? 'st-' + step.state : '')"), 'the dots colour by status');
  assert.ok(!PAGE.includes("color(step)") || PAGE.includes("step.state ? ''"), 'a status dot has no step colour');
});

test('the Fixed tab: every hold but the eligibility stop is a clean run', () => {
  const run = (at, needsFix, extra = {}) => ({at, needsFix, ...extra}), landed = '2026-10-10T00:00:00Z';
  assert.equal(statusOf([run('2026-10-11T00:00:00Z', false, {cleanHold: true}), run('2026-10-12T00:00:00Z', null, {hold: true})], landed).cleanRuns, 1, 'an eligibility stop (needsFix null) is neither');
  assert.equal(statusOf([run('2026-10-11T00:00:00Z', null, {cleanHold: true}), run('2026-10-12T00:00:00Z', null, {cleanHold: true})], landed).status, 'confirmed', 'two clean holds confirm');
  assert.equal(isCleanHold(rowStatus({reached: 'form', note: 'eligibility stop: x'})), false);
  assert.equal(isCleanHold(rowStatus({reached: 'posting', note: 'posting closed: held'})), false, 'a closed posting says nothing about the site');
  assert.ok(PAGE.includes('Better, not there yet'), 'a failing fix whose filled share rose reads as better');
  assert.ok(!PAGE.includes("'rung ' + (f.rung ?? '?')") && !PAGE.includes("rung ' + (r.rung ?? '?')"), 'an unknown rung is not drawn as "rung ?"');
});

test('two rows with one name on one host are told apart by their shape; every table inside a details box wraps its text', () => {
  assert.ok(PAGE.includes('twinTag(s)'), 'the pool table and Needs a fix tell twins apart');
  assert.ok(PAGE.includes('details table td:not(:first-child)'), 'the colors legend\'s paths wrap inside their card');
});

// Owner, 15 Oct 2026: the Status chips went (the Ending chips are finer and match the Outcomes tab; each row's pill still says its status). Every row is still filterable: one with no ending is "no ending yet".
test('the pool filters by ending, not by status: one chip per ending plus "no ending yet", every row in exactly one, and Clear resets it', () => {
  const snippet = PAGE.slice(PAGE.indexOf('/*filter*/'), PAGE.indexOf('/*end filter*/'));
  assert.ok(snippet.length > 50, 'the filter code is on the page');
  assert.doesNotMatch(PAGE, /pick\('status'|statusItems|chosen\.status|c\.status/, 'no status filter is left behind');
  const words = ['unresolved', 'ready', 'none'];   // none = no ending yet
  const rows = words.map(word => ({platform: 'P', flow: 'F', ending: word}));
  for (const word of words) {
    const inPool = new Function('poolMatches', 'endingMatch', `${snippet}; return inPool;`)(() => true, s => !word || s.ending === word);
    assert.deepEqual(rows.filter(s => inPool(s, {})).map(s => s.ending), [word], word + ' shows only its own rows');
  }
  assert.match(PAGE, /\[NO_ENDING, 'no ending yet · '/, 'a row with no ending has its own chip');
  for (const state of STATES) assert.ok(STATE_WORD[state], state + ' keeps its word for the row pill');
});

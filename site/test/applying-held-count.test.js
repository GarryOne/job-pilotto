// Owner, 15 Oct 2026: "held" counted 20 (Status chip), 17 (Ending chip) and 12 (Outcomes). One definition now: an ending is a row's newest main run's, the Outcomes pills and the Sites Ending chips count the same rows.
// A row with no ending is "no ending yet", never guessed from its status. The same word must give the same number on both tabs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PAGE} from '../src/applying.js';
import {STATES, STATE_WORD, rowStatus} from '../src/applying-status.js';
import {WORST_FIRST} from '../../extension/ladder/endings.js';

const make = tag => ({tag, children: [], hidden: false, style: {}, set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
  append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); },
  text() { return this.children.map(kid => (typeof kid === 'string' ? kid : kid.text())).join('|'); }});
const walk = (node, found = []) => { for (const kid of node.children || []) if (typeof kid === 'object') { found.push(kid); walk(kid, found); } return found; };
const row = (name, state) => ({name, shape: name, platform: 'Custom', flow: '', start: 'x.example', end: '', reached: 'form', history: ['form'], status: {...rowStatus({reached: 'form'}), state}, states: [], at: '2026-10-10T10:00:00Z', day: '2026-10-10', raw: '', short: null, shares: [], regression: false});

test('the same ending word gives the same number on the Outcomes pills and the Sites Ending chips, held included', async () => {
  // 3 held-by-test endings; one more row is held by STATUS only (no ending); two rows have no ending at all
  const spec = [['a', 'held', 'held'], ['b', 'held', 'held'], ['c', 'held', 'works'], ['d', 'ready', 'works'], ['e', 'ready', 'works'], ['f', 'unresolved', 'fix'], ['g', 'told', 'held'], ['h', null, 'held'], ['i', null, 'works'], ['j', null, 'fix']];
  const pool = spec.map(([name, , state]) => row(name, state)), rows = spec.filter(([, ending]) => ending).map(([name, ending]) => ({row: name, platform: 'Custom', ending, step: 'form', cause: null, source: 'mac', run: null, day: '2026-10-10', since: null}));
  const endings = Object.fromEntries(WORST_FIRST.filter(word => word !== 'held').map(word => [word, rows.filter(item => item.ending === word).length]));
  const body = {tiles: {}, cases: [], fixed: {rows: [], inProgress: []}, platforms: [], flows: [], nights: [], steps: ['none', 'posting', 'account', 'code/bot', 'form', 'ready'], states: STATES, stateWords: STATE_WORD, sites: [], dropped: [], now: '2026-10-10T12:00:00Z',
    next: {platforms: [], sites: [], hidden: {hosts: 0}}, pool, scorecard: [],
    resolution: {measured: rows.length - 3, held: 3, resolved: 2, raw: 40, weighted: null, covered: 0, samples: [], weeks: [], endings, unresolved: 1, rows}};
  const app = make('div'), script = PAGE.split('<script>')[1].split('</script>')[0];
  const document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', 'location', script)(document, async () => ({json: async () => body}), () => ({}), {escape: x => x}, () => 0, Object, {hash: '#sites'});
  await new Promise(resolve => setTimeout(resolve, 20));
  const all = walk(app);
  const pills = Object.fromEntries(all.filter(node => node.tag === 'button' && /^pill /.test(node.className || '')).map(node => node.text().match(/^(.+) (\d+)$/).slice(1)));
  const chipSet = all.find(node => node.className === 'pick chipset' && node.children[0].text() === 'Ending');
  const chips = Object.fromEntries(chipSet.children[1].children.map(chip => chip.text().split(' · ')));
  for (const word of WORST_FIRST) assert.equal(chips[word.replace('_', ' ')], pills[word.replace('_', ' ')], word + ': Ending chip = Outcomes pill');
  assert.equal(pills.held, '3', 'held counts the rows held by the test, on both tabs');
  assert.equal(chips['no ending yet'], '3', 'the rows with no ending are their own chip, so every row is filterable');
  assert.equal(Object.entries(chips).filter(([word]) => word !== 'All').reduce((sum, [, count]) => sum + Number(count), 0), pool.length, 'every pool row is in exactly one chip');
  assert.ok(!all.some(node => node.className === 'pick chipset' && node.children[0].text() === 'Status'), 'no Status chips');
});

test('a row\'s big status pill does not repeat its ending: the small pill under it says it', () => {
  assert.match(PAGE, /s\.status\.rule && s\.status\.state !== 'fix' && s\.status\.from !== 'ending' \? ' · ' \+ s\.status\.rule : ''/);
});

test('the page intro is one short line, with no claim of nightly runs', () => {
  const intro = PAGE.match(/<header><h1>[^]*?<\/header>\s*<p class="muted">([^]*?)<\/p>/)[1];
  assert.ok(intro.length < 200, intro);
  assert.doesNotMatch(intro, /Nightly|nightly|rotating share/);
});

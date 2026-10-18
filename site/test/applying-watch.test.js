// The Lab's ▶ Watch (src/applying-watch.js): a row with a fill video gets the button and the player in every list that draws a pool row, a row without one gets neither button nor broken player,
// and a list that draws pool rows without the helper fails here (the class, not the case). The fake page is the one test/applying-pagetabs.test.js uses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PAGE} from '../src/applying.js';
import {STATES, STATE_WORD, rowStatus} from '../src/applying-status.js';
import {WATCH_URL} from '../src/applying-watch.js';

const make = tag => ({tag, children: [], hidden: false, style: {}, set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
  append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); }});
const row = (name, reached) => ({name, shape: name, platform: 'Custom', flow: '', start: 'x.com', end: '', reached, history: [reached], status: rowStatus({reached}), states: [{...rowStatus({reached}), step: reached}], at: '2026-10-10T10:00:00Z', day: '2026-10-10', runs: [], short: null, regression: false});
const body = {tiles: {}, cases: [], fixed: {rows: [], inProgress: []}, platforms: [], flows: [], leftEmpty: '', tileTones: {}, tileRules: {}, whatWeTest: '', resolution: {measured: 0, endings: {ready: 0}, unresolved: [], samples: [], weeks: []}, fidelity: null,
  nights: [], steps: ['none', 'posting', 'account', 'code/bot', 'form', 'ready'], states: STATES, stateWords: STATE_WORD, stageWords: {}, stages: [], sites: [], dropped: [], now: '2026-10-10T12:00:00Z',
  next: {platforms: [], sites: [], hidden: {hosts: 0}}, pool: [row('Has video', 'form'), row('No video', 'form')], scorecard: []};
const walk = (node, found = []) => { for (const kid of node.children || []) if (typeof kid === 'object') { found.push(kid); walk(kid, found); } return found; };

const render = async index => {
  const app = make('div'), script = PAGE.split('<script>')[1].split('</script>')[0], asked = [];
  const document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  const fetch = async url => { asked.push(String(url)); return {json: async () => (String(url).startsWith(WATCH_URL) ? index : body)}; };
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', 'location', script)(document, fetch, () => ({}), {escape: x => x}, () => 0, Object, {hash: '#sites'});
  await new Promise(resolve => setTimeout(resolve, 30));
  return {app, asked};
};

test('a Sites row with a fill video gets a ▶ Watch button; a row without one gets none', async () => {
  const {app, asked} = await render({videos: {'Has video': {at: '2026-10-18T06:14:00.000Z', secs: 72, bytes: 900000}}});
  assert.ok(asked.includes(`${WATCH_URL}?index`), 'the page asks the owner-only index');
  const buttons = walk(app).filter(node => node.className === 'watchbtn');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, '▶ Watch 1:12');
});

test('the page still draws when the index is empty or fails', async () => {
  const {app} = await render({});
  assert.equal(walk(app).filter(node => node.className === 'watchbtn').length, 0);
  assert.ok(walk(app).some(node => node.className === 'pooltable'));
});

test('every list that draws a pool row shows the button and the player', () => {
  const script = PAGE.split('<script>')[1];
  const builders = [...script.matchAll(/const (\w+) = (\w) => \{ const on = (\w+)\.has\(\2\.(?:shape|site)\)/g)].map(match => [match[1], match[2]]);   // siteRows, needRow, fixRows: a row that opens by its shape or site
  assert.deepEqual(builders.map(([name]) => name).sort(), ['fixRows', 'needRow', 'siteRows'], 'a new list of pool rows must use ▶ Watch (and be added here)');
  for (const [name, arg] of builders) {
    const start = script.indexOf(`const ${name} = `), text = script.slice(start, start + 4000);
    assert.match(text, new RegExp(`watchButton\\(${arg}\\.(name|site)`), `${name} has no ▶ Watch button`);
    assert.match(text, new RegExp(`watchPlayer\\(${arg}\\.(name|site)\\)`), `${name} has no player in its details`);
  }
});

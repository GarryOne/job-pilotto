// Guards /admin/lab-form-filling's page tabs (src/applying-pagetabs.js): every section of the page is drawn inside a tab's panel, never straight under the tiles,
// one panel shows at a time, and the Fixed tab's #hash links still open the Fixes tab.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PAGE} from '../src/applying.js';
import {STATES, STATE_WORD, rowStatus} from '../src/applying-status.js';
import {PAGE_TABS, FIX_HASHES, PAGETABS_CSS} from '../src/applying-pagetabs.js';

const make = tag => ({tag, children: [], hidden: false, style: {}, set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
  append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); },
  text() { return this.children.map(kid => (typeof kid === 'string' ? kid : kid.text())).join('|'); }});
const row = (name, reached) => ({name, platform: 'Custom', flow: '', start: 'x.com', end: '', reached, history: [reached], status: rowStatus({reached}), states: [{...rowStatus({reached}), step: reached}], at: '2026-10-10T10:00:00Z', day: '2026-10-10', raw: '', short: null, shares: [], regression: false, running: false, note: null, rung: null, signal: null, cause: null});
const body = {tiles: {}, cases: [{name: 'case-1', rung: 1, origin: 'hand-cut', ok: 1, history: [1], at: '2026-10-10T10:00:00Z', since: {sha: 'abc1234', at: '2026-10-10T10:00:00Z'}, sha: 'abc1234'}], fixed: {rows: [], inProgress: []}, platforms: [], flows: [],
  nights: [{day: '2026-10-10', counts: {works: 1, held: 0, site: 0, fix: 1, unrun: 0}}], steps: ['none', 'posting', 'account', 'code/bot', 'form', 'ready'], states: STATES, stateWords: STATE_WORD, sites: [], dropped: [], now: '2026-10-10T12:00:00Z',
  next: {platforms: [], sites: [], hidden: {hosts: 0}}, resolution: {measured: 0, endings: {ready: 0}, unresolved: [], samples: [], weeks: []}, pool: [row('Aaa site', 'posting'), row('Bbb site', 'form')], scorecard: []};

const render = async hash => {
  const app = make('div'), script = PAGE.split('<script>')[1].split('</script>')[0];
  const document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', 'location', script)(document, async () => ({json: async () => body}), () => ({}), {escape: x => x}, () => 0, Object, {hash});
  await new Promise(resolve => setTimeout(resolve, 20));
  return app;
};
const walk = (node, found = []) => { for (const kid of node.children || []) if (typeof kid === 'object') { found.push(kid); walk(kid, found); } return found; };

test('every section of /admin/lab-form-filling sits in a tab panel; only the tiles and the tab bar are outside', async () => {
  const app = await render('');
  const panels = app.children.filter(kid => kid.className === 'panel'), outside = app.children.filter(kid => kid.className !== 'panel' && !kid.hidden);   // the hidden legend only lends its colors
  assert.deepEqual(outside.map(kid => kid.className), ['tiles', 'tabs pagetabs'], 'a block drawn straight into #app, outside every tab');
  assert.equal(panels.length, PAGE_TABS.length);
  panels.forEach((panel, at) => assert.ok(panel.children.length, PAGE_TABS[at][1] + ' tab is empty'));
  const sections = walk(app).filter(node => node.tag === 'section' || node.tag === 'details');
  assert.ok(sections.length >= 9, 'the page draws its sections: ' + sections.length);
  const inPanels = new Set(panels.flatMap(panel => walk(panel)));
  for (const section of sections) assert.ok(inPanels.has(section), 'a section outside every tab: ' + section.text().slice(0, 60));
  assert.equal((PAGE.match(/\bapp\.append\(/g) || []).length, 3, 'only the hidden legend, the tiles and the tab bar are appended to #app');
});

test('one panel shows at a time; a #hash opens its tab, and the Fixed tab links open Fixes', async () => {
  for (const [hash, want] of [['', 'resolution'], ['#pool', 'pool'], ['#replays', 'replays'], ['#coverage', 'coverage'], ...FIX_HASHES.map(fix => [fix, 'fixes']), ['#nope', 'resolution']]) {
    const app = await render(hash), panels = app.children.filter(kid => kid.className === 'panel');
    assert.deepEqual(panels.map(panel => !panel.hidden), PAGE_TABS.map(([id]) => id === want), hash + ' shows ' + want);
    const nav = app.children.find(kid => kid.className === 'tabs pagetabs');
    assert.deepEqual(nav.children.map(tab => tab['aria-selected']), PAGE_TABS.map(([id]) => String(id === want)));
  }
});

test('each tab holds its sections', async () => {
  const app = await render(''), panels = Object.fromEntries(app.children.filter(kid => kid.className === 'panel').map((panel, at) => [PAGE_TABS[at][0], panel.text()]));
  for (const [tab, words] of Object.entries({fixes: ['Needs a fix · where applying stops'], pool: ['By-hand runs · where each site got to', 'The AI ladder', 'The pool · every smoke site'],
    replays: ['Page cases'], coverage: ['Next sites to add', 'Platform scorecard']})) for (const word of words) assert.ok(panels[tab].includes(word), word + ' is not in the ' + tab + ' tab');
});

test('no block writes a missing part as the text "null" (a raw append() does; el() filters it)', async () => {
  const app = await render(''), texts = walk(app).flatMap(node => node.children.filter(kid => typeof kid === 'string'));
  assert.ok(texts.length > 20, 'the page drew text');
  assert.deepEqual(texts.filter(text => /^(null|undefined)$/.test(text)), []);
});

test('the page bar looks unlike the Fixes tab\'s folder tabs: an underline nav, styled after them so it wins', () => {
  assert.match(PAGETABS_CSS, /\.tabs\.pagetabs a\{[^}]*border:0[^}]*background:none/);
  assert.match(PAGETABS_CSS, /\.tabs\.pagetabs a\.on\{[^}]*inset 0 -3px 0 var\(--amber\)/);
  const css = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
  assert.ok(css.indexOf('.tabs a.on{') < css.indexOf('.tabs.pagetabs a.on{'), 'the folder-tab rules come first');
});

// Owner, 15 Oct 2026: "instead of this dropdown filter, let's make chip style filter". The class: every filter on the page. A short one (CHIP_MAX options
// or fewer: verdict, status, flow, case result/rung/origin) is a row of chips through chipFilter; only a long list (platforms) stays a dropdown.
test('the short filters are chips, one press picks and the all chip is on first; a long list stays a dropdown', async () => {
  const app = await render('#pool');
  const groups = walk(app).filter(node => node.className === 'pick chipset');
  const labels = groups.map(group => group.children[0].text());
  for (const label of ['Flow', 'Status']) assert.ok(labels.includes(label), label + ' is chips: ' + labels.join(', '));
  for (const group of groups) {
    const chips = group.children[1].children;
    assert.equal(chips[0].className, 'chip on', 'the all chip starts on');
    assert.ok(chips.slice(1).every(chip => chip.className === 'chip'), 'the others start off');
  }
  assert.match(PAGE, /chipFilter\('Verdict'/, 'the replay verdict filter is chips');
  assert.doesNotMatch(PAGE, /el\('select', \{'aria-label': 'Network verdict'/, 'the old verdict dropdown is gone');
  assert.match(PAGE, /list\.length <= CHIP_MAX/, 'pick() draws chips for a short list');
  assert.match(PAGE, /resetChips\(filters\)/); assert.match(PAGE, /resetChips\(caseFilters\)/);   // both Clear buttons reset the chips
});

// Owner, 15 Oct 2026: "not sure which dot is the last run, the left or the right? add an arrow for the direction". Oldest left, latest right.
test('the run dots read oldest to latest: the header says the direction and the latest dot is ringed and titled', () => {
  assert.equal((PAGE.match(/'Recent runs · old → new'/g) || []).length, 2, 'both Recent runs headers carry the arrow');
  assert.doesNotMatch(PAGE, /'Recent runs'[,\]]/);
  assert.match(PAGE, /at === list\.length - 1 && list\.length > 1 \? ' last' : ''/);
  assert.match(PAGE, /\.dots i\.last\{box-shadow:/);
  assert.match(PAGE, /'Latest run · '/);
});

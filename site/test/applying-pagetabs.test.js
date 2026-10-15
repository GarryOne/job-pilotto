// Guards /admin/lab-form-filling's page tabs (src/applying-pagetabs.js): every section of the page is drawn inside a tab's panel, never straight under the tiles,
// one panel shows at a time, and the old #hash links (#resolution, #pool, #needs-fix, #by-cause) open the tab that now holds their section.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PAGE} from '../src/applying.js';
import {STATES, STATE_WORD, rowStatus} from '../src/applying-status.js';
import {PAGE_TABS, FIX_HASHES, HASH_TAB, PAGETABS_CSS} from '../src/applying-pagetabs.js';

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

test('six tabs, each one question; the page opens on To fix', () => {
  assert.deepEqual(PAGE_TABS.map(([, name]) => name), ['To fix', 'Fixed', 'Sites', 'Outcomes', 'Replays', 'Coverage']);
});

test('one panel shows at a time; a #hash opens its tab, and the old links open the tab that holds their section', async () => {
  const cases = [['', 'tofix'], ['#fixed', 'fixed'], ['#sites', 'sites'], ['#outcomes', 'outcomes'], ['#replays', 'replays'], ['#coverage', 'coverage'], ['#nope', 'tofix'],
    ...Object.entries(HASH_TAB), ...FIX_HASHES.map(hash => [hash, 'tofix'])];
  assert.deepEqual([HASH_TAB['#resolution'], HASH_TAB['#pool']], ['outcomes', 'sites'], 'the old tab names still work');
  for (const [hash, want] of cases) {
    const app = await render(hash), panels = app.children.filter(kid => kid.className === 'panel');
    assert.deepEqual(panels.map(panel => !panel.hidden), PAGE_TABS.map(([id]) => id === want), hash + ' shows ' + want);
    const nav = app.children.find(kid => kid.className === 'tabs pagetabs');
    assert.deepEqual(nav.children.map(tab => tab['aria-selected']), PAGE_TABS.map(([id]) => String(id === want)));
  }
});

// Each section sits in the tab the owner approved (15 Oct 2026), and nowhere else.
test('each tab holds its sections', async () => {
  const app = await render(''), panels = Object.fromEntries(app.children.filter(kid => kid.className === 'panel').map((panel, at) => [PAGE_TABS[at][0], panel.text()]));
  const WHERE = {tofix: ['Needs a fix · where applying stops', 'By cause · what to fix first'], fixed: ['Fix verification', 'Page cases'], sites: ['The pool · every smoke site', 'The AI ladder'],
    outcomes: ['Resolution · how each application ends', 'By-hand runs · where each site got to'], replays: ['Replay vs live'], coverage: ['Platform scorecard', 'Next sites to add']};
  for (const [tab, words] of Object.entries(WHERE)) for (const word of words) {
    if (word === 'Replay vs live') continue;   // drawn from the fidelity data; the stub has none
    assert.ok(panels[tab].includes(word), word + ' is not in the ' + tab + ' tab');
    for (const [other, text] of Object.entries(panels)) if (other !== tab) assert.ok(!text.includes(word), word + ' is also in the ' + other + ' tab');
  }
  for (const gone of ['Every pool row', 'How the weighted number is built']) assert.ok(!Object.values(panels).some(text => text.includes(gone)), gone + ' went into another table');
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
  const app = await render('#sites');
  const groups = walk(app).filter(node => node.className === 'pick chipset');
  const labels = groups.map(group => group.children[0].text());
  for (const label of ['Flow', 'Ending']) assert.ok(labels.includes(label), label + ' is chips: ' + labels.join(', '));
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

// Owner, 15 Oct 2026: "improve the text alignment" of the chip filters: a chip row is as tall as the search box, so the labels and the count line up.
test('a chip row is as tall as an input, its chips centred', () => {
  const height = PAGE.match(/\.pick input\[type=search\],\.pick select\{[^}]*height:(\d+)px/)[1];
  assert.match(PAGE, new RegExp('\\.chiprow\\{[^}]*align-items:center;min-height:' + height + 'px'));
});

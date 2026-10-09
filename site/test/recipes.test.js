// The shared recipe library (src/recipes.js): what it accepts, what it serves, and how a canary is promoted or halted.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {appliesTo, bucketOf, validateBundle, validateRecipe} from '../../extension/recipe-schema.js';
import {flags, guard} from '../src/guard.js';
import {PRIOR_BOARDS, cleanSkeleton, controlStats, controls, evaluateCanary, installToken, lab, labPlan, labReport, lookup, publicUrl, recipes, targets} from '../src/recipes.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0004_recipes.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/0005_lab.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/0006_exposure.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/0008_guard.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/0022_form_required.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/0009_knowledge.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/0017_alias_proposals.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/0044_family_counts.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'secret'});
const recipe = (extra = {}) => ({fingerprint: '1d2pcapx18', version: 1, operator: 'toggle', params: {onAttr: 'aria-pressed', onValue: 'true'}, ...extra});
const put = (e, body, key = 'secret') => recipes(new Request('https://x/api/recipes', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), e);
const get = (e, headers = {Authorization: 'Bearer secret'}) => recipes(new Request('https://x/api/recipes', {headers}), e);
const kvStore = () => { const map = new Map(); return {get: async key => map.get(key) ?? null, put: async (key, value) => { map.set(key, value); }}; };
const now = new Date('2026-10-02T12:00:00Z');

test('a recipe is data in a fixed shape; anything else is refused', () => {
  assert.equal(validateRecipe(recipe()).ok, true);
  assert.equal(validateRecipe(recipe({operator: 'run-code'})).ok, false);
  assert.equal(validateRecipe(recipe({fingerprint: 'NOT VALID'})).ok, false);
  assert.equal(validateRecipe(recipe({params: {option: 'button[type=submit]'}})).ok, false);   // never a submit control
  assert.equal(validateRecipe(recipe({params: {option: 'div > button, javascript:alert(1)'}})).ok, false);
  assert.equal(validateRecipe(recipe({params: {onAttr: 'onclick'}})).ok, false);
  assert.deepEqual(validateRecipe(recipe({params: {option: '.yesno button', evil: 'x'}, extra: 1})).recipe.params, {option: '.yesno button'});   // unknown fields dropped
  assert.equal(validateRecipe(recipe({operator: 'date', params: {order: 'dmy', sep: '.'}})).ok, true);
  assert.equal(validateRecipe(recipe({operator: 'date', params: {order: 'xyz'}})).ok, false);
});

test('the highest version of a fingerprint wins in a bundle; rollout is a share of installs, stable per install', () => {
  const list = validateBundle([recipe(), recipe({version: 3, params: {}}), recipe({fingerprint: 'zzzzzz1'}), {junk: true}]);
  assert.deepEqual(list.map(item => [item.fingerprint, item.version]), [['1d2pcapx18', 3], ['zzzzzz1', 1]]);
  assert.equal(bucketOf('install-a'), bucketOf('install-a'));
  const installs = Array.from({length: 400}, (_, i) => `install-${i}`);
  const share = installs.filter(id => appliesTo({rollout: 25}, id)).length / installs.length;
  assert.ok(share > 0.15 && share < 0.35, `about a quarter of installs, got ${share}`);
  assert.equal(installs.every(id => appliesTo({rollout: 100}, id)), true);
  assert.equal(installs.some(id => appliesTo({rollout: 0}, id)), false);
});

test('only the owner adds recipes or reads the whole set; GET shows running ones with their rollout, newest version only', async () => {
  const e = env();
  assert.equal((await get(e, {})).status, 404);   // the whole library is not public
  assert.equal((await put(e, {recipe: recipe()}, 'wrong')).status, 404);
  assert.equal((await put(e, {recipe: recipe({operator: 'x'})})).status, 400);
  await put(e, {recipe: recipe(), status: 'candidate'});
  assert.deepEqual((await (await get(e)).json()).recipes, []);   // a candidate is not served
  await put(e, {recipe: recipe(), status: 'canary', rollout: 5});
  await put(e, {recipe: recipe({version: 2}), status: 'verified'});
  const response = await get(e);
  const served = (await response.json()).recipes;
  assert.deepEqual(served.map(r => [r.fingerprint, r.version, r.rollout]), [['1d2pcapx18', 2, 100]]);
  assert.equal((await get(e, {Authorization: 'Bearer secret', 'If-None-Match': response.headers.get('ETag')})).status, 304);
});

test('a control report keeps only structure, a few samples per fingerprint, and sums outcomes', async () => {
  const e = env();
  const skeleton = {t: 'div', a: {role: 'radiogroup', onclick: 'x()', 'aria-pressed': ''}, c: ['yesno', 'BAD WORD', 'ok-class'], text: 'Igor Mardari', k: [{t: 'button', a: {}, c: [], k: [], value: 'secret'}]};
  const send = body => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-1234', ...body})}), e, now);
  assert.equal((await send({})).status, 200);
  assert.equal((await controls(new Request('https://x/api/controls', {method: 'POST', body: '{}'}), e, now)).status, 400);
  for (let i = 0; i < 5; i++) await send({samples: [{fingerprint: 'abc123', kind: 'switch', skeleton, question: 'Remote?'}]});
  const rows = e.STATS.db.prepare('SELECT * FROM control_samples').all();
  assert.equal(rows.length, 3);
  assert.doesNotMatch(rows[0].skeleton, /Igor|secret|onclick|BAD/);
  assert.match(rows[0].skeleton, /radiogroup/);
  await send({outcomes: [{fp: 'abc123', recipe: 1, ok: 3, failed: 1}, {fp: 'bad fp', ok: 1}]});
  await send({outcomes: [{fp: 'abc123', recipe: 1, ok: 2, failed: 0}]});
  assert.deepEqual(e.STATS.db.prepare('SELECT ok, failed FROM control_outcomes').all().map(r => ({...r})), [{ok: 5, failed: 1}]);
  assert.equal(cleanSkeleton({t: 'Bad Tag'}), null);
});

test('a canary that works grows and finally becomes verified; one that fails is halted; too little evidence changes nothing', async () => {
  const e = env();
  const day = '2026-10-02';
  const record = (fp, version, ok, failed, on = day) => e.STATS.db.prepare('INSERT INTO control_outcomes (day, fingerprint, recipe, ok, failed) VALUES (?, ?, ?, ?, ?)').run(on, fp, version, ok, failed);
  await put(e, {recipe: recipe(), status: 'canary', rollout: 5}, 'secret');
  await put(e, {recipe: recipe({fingerprint: 'bad0001'}), status: 'canary', rollout: 5});
  await put(e, {recipe: recipe({fingerprint: 'new0001'}), status: 'canary', rollout: 5});
  // `put` stamps updated_at from the real clock; the attempts below are dated by the test's own day, so pin it (the test failed once the real date passed it).
  e.STATS.db.prepare("UPDATE recipes SET updated_at = '2026-10-02T00:00:00Z' WHERE status = 'canary'").run();
  record('1d2pcapx18', 1, 58, 2);      // 3% failed over 60 attempts: grow
  record('bad0001', 1, 12, 10);        // 45% failed over 22: halt
  record('new0001', 1, 4, 0);          // too few attempts: leave
  const actions = await evaluateCanary(e.STATS, now);
  assert.deepEqual(actions.map(a => [a.recipe, a.action]).sort(), [['1d2pcapx18 v1', 'grown to 25%'], ['bad0001 v1', 'halted']]);
  const status = fp => e.STATS.db.prepare('SELECT status, rollout FROM recipes WHERE fingerprint = ?').get(fp);
  assert.deepEqual({...status('1d2pcapx18')}, {status: 'canary', rollout: 25});
  assert.deepEqual({...status('bad0001')}, {status: 'disabled', rollout: 0});
  assert.deepEqual({...status('new0001')}, {status: 'canary', rollout: 5});
  e.STATS.db.prepare("UPDATE recipes SET updated_at = '2026-10-02T00:00:00Z' WHERE fingerprint = '1d2pcapx18'").run();
  record('1d2pcapx18', 1, 100, 1, '2026-10-03');
  const later = await evaluateCanary(e.STATS, now);
  assert.deepEqual(later.map(a => a.action), ['verified']);
  assert.deepEqual({...status('1d2pcapx18')}, {status: 'verified', rollout: 100});
  assert.deepEqual((await controlStats(e.STATS, 7, now)).map(r => r.fingerprint).sort(), ['1d2pcapx18', 'bad0001', 'new0001']);
});

test('an app gets a token, then recipes only for the fingerprints it presents, at its own canary share', async () => {
  const e = {...env(), WAITLIST: kvStore()};
  await put(e, {recipe: recipe(), status: 'verified'});
  await put(e, {recipe: recipe({fingerprint: 'other0001'}), status: 'verified'});
  await put(e, {recipe: recipe({fingerprint: 'draft0001'}), status: 'candidate'});
  await put(e, {recipe: recipe({fingerprint: 'tiny0001'}), status: 'canary', rollout: 1});
  const mint = install => installToken(new Request('https://x/api/install-token', {method: 'POST', headers: {'CF-Connecting-IP': '203.0.113.7'}, body: JSON.stringify({install})}), e, now);
  const ask = (install, token, fingerprints) => lookup(new Request('https://x/api/recipes/lookup', {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: JSON.stringify({install, fingerprints})}), e, now);
  const {token} = await (await mint('install-aaaa1111')).json();
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal((await ask('install-aaaa1111', 'wrong', ['1d2pcapx18'])).status, 401);
  assert.equal((await ask('install-bbbb2222', token, ['1d2pcapx18'])).status, 401);   // a token is for its own install
  const served = (await (await ask('install-aaaa1111', token, ['1d2pcapx18', 'draft0001', 'nothing999', 'NOT VALID'])).json()).recipes;
  assert.deepEqual(served.map(r => r.fingerprint), ['1d2pcapx18']);   // only what it presented, only what is running
  // a 1% canary reaches a fraction of installs only
  const reached = [];
  for (let i = 0; i < 200; i++) {
    const id = `install-${String(i).padStart(8, '0')}`;
    const {token: t} = await (await installToken(new Request('https://x/api/install-token', {method: 'POST', body: JSON.stringify({install: id})}), {...e, WAITLIST: undefined}, now)).json();
    const got = (await (await ask(id, t, ['tiny0001'])).json()).recipes;
    if (got.length) reached.push(id);
  }
  assert.ok(reached.length > 0 && reached.length < 20, `about 1% of 200, got ${reached.length}`);
});

test('minting tokens is limited per network address; lookups are limited per install', async () => {
  const e = {...env(), WAITLIST: kvStore()};
  const mint = n => installToken(new Request('https://x/api/install-token', {method: 'POST', headers: {'CF-Connecting-IP': '198.51.100.9'}, body: JSON.stringify({install: `install-${n}-xxxxxxx`})}), e, now);
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await mint(i)).status);
  assert.deepEqual([statuses.filter(s => s === 200).length, statuses.filter(s => s === 429).length], [10, 2]);
  const {token} = await (await installToken(new Request('https://x/api/install-token', {method: 'POST', headers: {'CF-Connecting-IP': '198.51.100.10'}, body: JSON.stringify({install: 'install-quota-1'})}), e, now)).json();
  const ask = fingerprints => lookup(new Request('https://x/api/recipes/lookup', {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: JSON.stringify({install: 'install-quota-1', fingerprints})}), e, now);
  const many = Array.from({length: 30}, (_, i) => `fp${String(i).padStart(5, '0')}`);
  let last = 200;
  for (let i = 0; i < 70 && last === 200; i++) last = (await ask(many)).status;
  assert.equal(last, 429);
});

test('only the owner posts what the lab saw; candidates can be fetched by the owner to try; the report sums per site and kind', async () => {
  const e = env();
  const post = (body, key = 'secret') => lab(new Request('https://x/api/lab', {method: 'POST', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), e, now);
  assert.equal((await post({}, 'wrong')).status, 404);
  const skeleton = {t: 'div', a: {role: 'radiogroup'}, c: ['yesno'], text: 'nope', k: []};
  const result = await (await post({runs: [
    {site: 'Ashby', fingerprint: '1d2pcapx18', kind: 'toggle-group', ok: true}, {site: 'ashby', fingerprint: '1d2pcapx18', kind: 'toggle-group', ok: false, why: 'x'},
    {site: 'lever', fingerprint: 'bad fp', ok: true}], samples: [{fingerprint: '1d2pcapx18', kind: 'toggle-group', skeleton, question: 'Remote?'}]})).json();
  assert.deepEqual([result.runs, result.samples], [2, 1]);
  assert.doesNotMatch(e.STATS.db.prepare('SELECT skeleton FROM control_samples').get().skeleton, /nope/);
  const report = await labReport(e.STATS, 7, now);
  assert.deepEqual(report.map(r => [r.site, r.kind, r.ok, r.failed]), [['ashby', 'toggle-group', 1, 1]]);
  await put(e, {recipe: recipe({fingerprint: 'cand0001'}), status: 'candidate'});
  const candidates = await (await recipes(new Request('https://x/api/recipes?status=candidate', {headers: {Authorization: 'Bearer secret'}}), e)).json();
  assert.deepEqual(candidates.recipes.map(r => [r.fingerprint, r.status]), [['cand0001', 'candidate']]);
});

test('the lab plan follows real use: busy boards by fills, the head is what fails or is unproven, coverage is exposure-weighted', async () => {
  const e = env();
  const send = body => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-1234', ...body})}), e, now);
  // too little real use: the prior decides which boards
  assert.deepEqual((await labPlan(e.STATS, now)).boards.map(b => [b.board, b.source]).slice(0, 2), [['greenhouse', 'prior'], ['lever', 'prior']]);
  await send({exposure: [{board: 'ashby', n: 80}, {board: 'greenhouse', n: 20}, {board: 'h:0123456789', n: 500}, {board: 'bad board!', n: 5}],
    outcomes: [{fp: 'busy0001', recipe: 0, ok: 90, failed: 10}, {fp: 'rare0001', recipe: 0, ok: 2, failed: 0}, {fp: 'okok0001', recipe: 0, ok: 60, failed: 0}]});
  const run = (fp, ok, url) => e.STATS.db.prepare('INSERT INTO lab_runs (day, site, fingerprint, kind, recipe, ok, why, url) VALUES (?, ?, ?, ?, 0, ?, ?, ?)').run('2026-10-02', 'ashby', fp, 'toggle-group', ok, '', url);
  for (let i = 0; i < 6; i++) { run('okok0001', 1, `https://jobs.ashbyhq.com/a/${i}/application`); run('busy0001', i < 3 ? 1 : 0, 'https://jobs.ashbyhq.com/b/1/application'); }
  const plan = await labPlan(e.STATS, now);
  assert.deepEqual(plan.boards.map(b => [b.board, b.weight, b.source]), [['ashby', 80, 'usage'], ['greenhouse', 20, 'usage']]);   // hashed and invalid boards are not named
  assert.deepEqual(plan.head.map(item => item.fingerprint), ['busy0001', 'rare0001']);   // failing first; the healthy one rests
  assert.deepEqual(plan.head[0].urls, ['https://jobs.ashbyhq.com/b/1/application']);
  assert.equal(plan.head[1].labRuns, 0);   // never tried by the lab: unproven
  assert.equal(Math.round(plan.coverage * 100), Math.round(60 / 162 * 100));   // only okok0001 (60 of 162 meetings) is healthy
  assert.equal(publicUrl('https://jobs.ashbyhq.com/a/1/application?token=secret#x'), 'https://jobs.ashbyhq.com/a/1/application');
  assert.equal(publicUrl('http://insecure.example/x'), '');
  const asked = await lab(new Request('https://x/api/lab', {headers: {Authorization: 'Bearer secret'}}), e, now);
  assert.equal((await asked.json()).boards[0].board, 'ashby');
  assert.equal((await lab(new Request('https://x/api/lab'), e, now)).status, 404);
  assert.ok(PRIOR_BOARDS.greenhouse > PRIOR_BOARDS.lever);
});

test('the proposer\'s targets: failing controls without a recipe being tried, worst first, with samples; owner only', async () => {
  const e = env();
  const send = body => controls(new Request('https://x/api/controls', {method: 'POST', body: JSON.stringify({install: 'install-1234', ...body})}), e, now);
  const skeleton = {t: 'div', a: {role: 'radiogroup'}, c: ['yesno'], k: []};
  await send({outcomes: [{fp: 'worst001', recipe: 0, ok: 5, failed: 40}, {fp: 'fine0001', recipe: 0, ok: 50, failed: 0}, {fp: 'tried001', recipe: 0, ok: 1, failed: 30},
    {fp: 'nosample1', recipe: 0, ok: 0, failed: 99}, {fp: 'again001', recipe: 0, ok: 0, failed: 5}],
    samples: [{fingerprint: 'worst001', kind: 'toggle-group', skeleton, question: 'Are you based in the US?'}, {fingerprint: 'tried001', kind: 'select', skeleton, question: 'Country'},
      {fingerprint: 'again001', kind: 'date', skeleton, question: 'Start date'}]});
  e.STATS.db.prepare('INSERT INTO lab_runs (day, site, fingerprint, kind, recipe, ok, why, url) VALUES (?, ?, ?, ?, 0, 0, ?, ?)').run('2026-10-02', 'ashby', 'worst001', 'toggle-group', 'no option found', '');
  await put(e, {recipe: recipe({fingerprint: 'tried001'}), status: 'candidate'});
  for (const version of [1, 2, 3]) await put(e, {recipe: recipe({fingerprint: 'again001', version}), status: 'disabled'});
  const ask = (headers = {Authorization: 'Bearer secret'}, query = '') => targets(new Request(`https://x/api/recipes/targets${query}`, {headers}), e, now);
  assert.equal((await ask({})).status, 404);
  const { targets: list } = await (await ask()).json();
  assert.deepEqual(list.map(item => item.fingerprint), ['worst001']);   // tried001 has a candidate, again001 rests after 3 tries, nosample1 has nothing to show, fine0001 does not fail
  assert.deepEqual([list[0].kind, list[0].question, list[0].version, list[0].whys, list[0].userFailed, list[0].labFailed], ['toggle-group', 'Are you based in the US?', 1, ['no option found'], 40, 1]);
  assert.deepEqual(list[0].samples[0], {t: 'div', a: {role: 'radiogroup'}, c: ['yesno'], k: []});
  assert.equal((await targets(new Request('https://x/api/recipes/targets', {method: 'POST', headers: {Authorization: 'Bearer secret'}}), e, now)).status, 405);
});

const mintFor = async (e, install, purpose, ip = '198.51.100.20') => (await (await installToken(new Request('https://x/api/install-token', {method: 'POST', headers: {'CF-Connecting-IP': ip},
  body: JSON.stringify({install, purpose})}), e, now)).json()).token;
const lookupAs = (e, install, token, fingerprints) => lookup(new Request('https://x/api/recipes/lookup', {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: JSON.stringify({install, fingerprints})}), e, now);
const owner = (e, body) => guard(new Request('https://x/api/guard', {method: body ? 'POST' : 'GET', headers: {Authorization: 'Bearer secret'}, body: body ? JSON.stringify(body) : undefined}), e, now);

test('a token opens only its own door: an index token cannot look up recipes', async () => {
  const e = {...env(), WAITLIST: kvStore()};
  const forIndex = await mintFor(e, 'install-door-1', 'index');
  const forRecipes = await mintFor(e, 'install-door-1', 'recipes');
  assert.notEqual(forIndex, forRecipes);
  assert.equal((await lookupAs(e, 'install-door-1', forIndex, ['abc12345'])).status, 401);
  assert.equal((await lookupAs(e, 'install-door-1', forRecipes, ['abc12345'])).status, 200);
});

test('asking for a honeypot fingerprint quietly revokes the install, flags it, and the token stops working', async () => {
  const e = {...env(), WAITLIST: kvStore()};
  assert.equal((await owner(e, {action: 'honeypots', count: 3})).status, 200);
  const decoy = e.STATS.db.prepare('SELECT fingerprint FROM honeypots LIMIT 1').get().fingerprint;
  assert.match(decoy, /^[a-z0-9]{10}$/);
  const token = await mintFor(e, 'install-scan-001', 'recipes');
  const answer = await lookupAs(e, 'install-scan-001', token, [decoy]);
  assert.deepEqual([answer.status, (await answer.json()).recipes], [200, []]);   // answered as if nothing was found
  assert.equal((await lookupAs(e, 'install-scan-001', token, ['abc12345'])).status, 401);   // revoked
  const seen = await flags(e.STATS, 7, now);
  assert.deepEqual([seen.seen[0].kind, seen.revoked[0].reason, seen.honeypots], ['honeypot', 'asked for a honeypot', 3]);
  assert.equal(JSON.stringify(seen).includes('install-scan-001'), false, 'only a digest of the install is kept');
  const who = seen.revoked[0].who;
  await owner(e, {action: 'unrevoke', who});
  assert.equal((await lookupAs(e, 'install-scan-001', token, ['abc12345'])).status, 200);
});

test('reaching a quota or the minting limit is flagged for the owner to see; only the owner reads or changes the guard', async () => {
  const e = {...env(), WAITLIST: kvStore()};
  for (let i = 0; i < 11; i++) await mintFor(e, `install-mint-${i}-xx`, 'recipes', '198.51.100.30');
  const token = await mintFor(e, 'install-quota-xx', 'recipes', '198.51.100.31');
  const many = Array.from({length: 30}, (_, i) => `fp${String(i).padStart(5, '0')}`);
  for (let i = 0; i < 70; i++) await lookupAs(e, 'install-quota-xx', token, many);
  const kinds = (await flags(e.STATS, 7, now)).seen.map(row => row.kind).sort();
  assert.deepEqual(kinds, ['mint', 'quota']);
  assert.equal((await guard(new Request('https://x/api/guard'), e, now)).status, 404);
  assert.equal((await guard(new Request('https://x/api/guard', {method: 'POST', headers: {Authorization: 'Bearer wrong'}, body: '{}'}), e, now)).status, 404);
  assert.equal((await owner(e, {action: 'nope'})).status, 400);
  assert.equal((await owner(e)).status, 200);
});

test('the guard never blocks a real user when its tables are missing', async () => {
  const e = {...env(), WAITLIST: kvStore()};
  e.STATS.db.exec('DROP TABLE revoked; DROP TABLE honeypots; DROP TABLE anomalies;');
  const token = await mintFor(e, 'install-nogd-001', 'recipes');
  assert.equal((await lookupAs(e, 'install-nogd-001', token, ['abc12345'])).status, 200);
});

test('a verified recipe that starts failing in real use is rolled back; a healthy one is left alone', async () => {
  const {evaluateVerified} = await import('../src/recipes.js');
  const e = env();
  const add = (fp, version, status) => e.STATS.db.prepare("INSERT INTO recipes (fingerprint, version, status, rollout, body, source, note, created_at, updated_at) VALUES (?, ?, ?, 100, '{}', 'test', '', 'x', 'x')").run(fp, version, status);
  add('badfp0001', 1, 'verified'); add('goodfp0001', 1, 'verified');
  const out = (fp, ok, failed) => e.STATS.db.prepare('INSERT INTO control_outcomes (day, fingerprint, recipe, ok, failed) VALUES (?, ?, 1, ?, ?)').run('2026-10-01', fp, ok, failed);
  out('badfp0001', 20, 20); out('goodfp0001', 60, 2);
  const actions = await evaluateVerified(e.STATS, new Date('2026-10-02T12:00:00Z'));
  assert.deepEqual(actions.map(a => [a.recipe, a.action]), [['badfp0001 v1', 'rolled back']]);
  assert.deepEqual(e.STATS.db.prepare('SELECT fingerprint, status FROM recipes ORDER BY fingerprint').all().map(r => [r.fingerprint, r.status]), [['badfp0001', 'disabled'], ['goodfp0001', 'verified']]);
});

test('an upload recipe names only the trigger that opens the slot, as a safe selector', () => {
  const ok = validateRecipe({fingerprint: 'abc123xyz', version: 1, operator: 'upload', params: {trigger: '.addAttachments, [role=button]'}});
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.recipe.params, {trigger: '.addAttachments, [role=button]'});
  assert.equal(validateRecipe({fingerprint: 'abc123xyz', version: 1, operator: 'upload', params: {trigger: 'button[type=submit]'}}).ok, false, 'never a submit control');
  assert.equal(validateRecipe({fingerprint: 'abc123xyz', version: 1, operator: 'upload', params: {trigger: '<script>'}}).ok, false);
  assert.equal(validateRecipe({fingerprint: 'abc123xyz', version: 1, operator: 'upload', params: {option: '.x'}}).recipe.params.option, undefined, 'only the trigger is kept');
});

// "Read sites only you can open" (7 Oct 2026): N at a time, each waits for its extension report, a silent one counts as stopped; the result
// message the app writes is exactly what its card reads.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {done, heardFrom, resultMessage, runAll} from '../lib/visits.js';
import {parseVisits} from '../renderer/visits-card.js';

test('sites open a few at a time, each closes on its report, a silent one stops in time', async () => {
  const opened = [];
  let open = 0, most = 0;
  const openTab = url => {
    opened.push(url); open++; most = Math.max(most, open);
    const start = url.split('#')[0], ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (!start.includes('silent')) setTimeout(() => { open--; done({url: start.replace('b.example', 'b.example.ch'), ticket, jobs: start.includes('empty') ? 0 : 12, added: 3, pages: 2, stopped: start.includes('empty') ? 'the site asks you to sign in' : 'no next page'}); }, 20);
    else setTimeout(() => { open--; }, 60);
    return {ok: true};
  };
  const sites = ['a', 'b', 'empty', 'silent'].map(name => ({name, url: `https://${name}.example/jobs`}));
  const results = await runAll(sites, {atOnce: 2, openTab, waitMs: 80});
  assert.equal(most, 2, 'never more than two at once');
  assert.ok(opened.every(url => /#jp-read-filter-[a-z0-9]{8}$/.test(url)), 'each tab carries its ticket');
  assert.deepEqual(results.map(result => [result.name, result.ok, result.jobs]), [['a', true, 12], ['b', true, 12], ['empty', false, 0], ['silent', false, 0]]);
  assert.match(results[3].why, /no answer from the extension/);
});

test('the result message is what the card reads, with each stopped site and its address', () => {
  const text = resultMessage([{name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/search/?keywords=photographe', ok: true, jobs: 64, added: 20},
    {name: 'Rolex', url: 'https://www.rolex.com', ok: false, why: 'the site asks you to sign in · do it, then click again', jobs: 0, added: 0}]);
  const card = parseVisits(text);
  assert.deepEqual([card.read, card.total, card.jobs, card.fresh], [1, 2, 64, 20]);
  assert.deepEqual(card.sites.map(site => [site.name, site.ok, site.url]), [['LinkedIn', true, 'https://www.linkedin.com/jobs/search/?keywords=photographe'], ['Rolex', false, 'https://www.rolex.com']]);
  assert.match(card.sites[1].detail, /sign in/);
});

test('a site that goes silent is skipped after the quiet time, in plain words, and the next one runs', async () => {
  const lines = [];
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('live')) setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 5, added: 5, pages: 1, stopped: 'no next page'}), 20);
    return {ok: true};   // 'mute' never reports: the extension's worker died
  };
  const results = await runAll([{name: 'Mute', url: 'https://mute.example'}, {name: 'Live', url: 'https://live.example'}], {atOnce: 1, openTab, quietMs: 60, waitMs: 5000, tee: line => lines.push(line)});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Mute', false], ['Live', true]]);
  assert.match(results[0].why, /stopped answering/);
  assert.ok(lines.some(line => /Mute is not responding: skipped, the next site opens/.test(line)));
});

test('a site that keeps talking but never finishes is stopped at its time budget (owner: 30-60 s a site), and the next one runs', async () => {
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('slow')) { const talk = setInterval(() => heardFrom(ticket), 10); setTimeout(() => clearInterval(talk), 400); }
    else setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 3, added: 3, pages: 1, stopped: 'no next page'}), 20);
    return {ok: true};
  };
  const results = await runAll([{name: 'Slow', url: 'https://slow.example'}, {name: 'Quick', url: 'https://quick.example'}], {atOnce: 1, openTab, quietMs: 1000, siteMs: 80, waitMs: 5000});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Slow', false], ['Quick', true]]);
  assert.match(results[0].why, /s are up: skipped, the jobs read so far are kept/);
});

test('a Read sites run draws a row per tab at its latest state, and how far it is', async () => {
  const {siteLine} = await import('../lib/visits.js');
  const {parseSiteRows} = await import('../renderer/visits-card.js');
  const log = ['Reading 3 sites in your browser, 2 at a time', siteLine('next', 'Tag Heuer', 'https://www.tagheuer.com'), siteLine('next', 'Hublot · CH', 'https://www.hublot.com'),
    siteLine('next', 'Glassdoor', 'https://de.glassdoor.ch'), siteLine('opening', 'Tag Heuer', 'Opening in Chrome…'), siteLine('reading', 'Tag Heuer', 'page 2 · 14 jobs'),
    '⏳ Reading sites in your browser: 0 of 3 done · 0% · now Tag Heuer', siteLine('waiting', 'Hublot · CH', 'Waiting for you in Chrome'), siteLine('done', 'Tag Heuer', '14 jobs (8 new)'),
    siteLine('stopped', 'Glassdoor', 'it stopped answering')];
  const rows = parseSiteRows(log);
  assert.deepEqual(rows.sites.map(site => [site.name, site.state]), [['Tag Heuer', 'done'], ['Hublot, CH', 'waiting'], ['Glassdoor', 'stopped']]);
  assert.equal(rows.sites[0].url, 'https://www.tagheuer.com');
  assert.deepEqual([rows.done, rows.total, rows.percent], [2, 3, 67]);
  assert.equal(parseSiteRows(['no rows here']), null);
});

test('runAll writes each site\'s states, in order, for those rows', async () => {
  const {siteLine} = await import('../lib/visits.js');
  const lines = [];
  const openTab = url => { const ticket = /-([a-z0-9]+)$/.exec(url)[1]; setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 4, added: 1, pages: 1}), 10); return {ok: true}; };
  await runAll([{name: 'A', url: 'https://a.example'}], {openTab, tee: line => lines.push(line), waitMs: 500});
  assert.deepEqual(lines.filter(line => line.includes('▸')), [siteLine('next', 'A', 'https://a.example'), siteLine('opening', 'A', 'Opening in Chrome…'), siteLine('done', 'A', '4 jobs read (1 new), 0 matching your search')]);
  assert.ok(lines.some(line => /^⏳ .*1 of 1 · 100%/.test(line)), 'the banner\'s step says the percent');
});

test('a read tab you close ends that site at once, said in its row, and the next site opens', async () => {
  const {noteTabs, siteLine} = await import('../lib/visits.js');
  const lines = [];
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('closeme')) {
      setTimeout(() => noteTabs({ids: [1, 41], boot: 'b1', reading: {[ticket]: 41}}), 10);   // Chrome reports the tab
      setTimeout(() => noteTabs({ids: [1], boot: 'b1', reading: {}}), 30);                   // ... then the person closes it
    } else setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 2, added: 2, pages: 1}), 10);
    return {ok: true};
  };
  const started = Date.now();
  const results = await runAll([{name: 'Closeme', url: 'https://closeme.example'}, {name: 'Next', url: 'https://next.example'}],
    {atOnce: 1, openTab, tee: line => lines.push(line), waitMs: 5000, quietMs: 5000, siteMs: 5000});
  assert.ok(Date.now() - started < 1000, 'no timeout waited');
  assert.deepEqual(results.map(result => [result.name, result.ok, result.why]), [['Closeme', false, 'You closed the tab'], ['Next', true, '']]);
  assert.ok(lines.includes(siteLine('closed', 'Closeme', 'You closed the tab')));
  noteTabs({ids: [], boot: 'b1', reading: {}});   // an older extension's report (no reading) changes nothing either way
  noteTabs({ids: [1], boot: 'b1'});
});

test('"Open again" puts a site whose tab you closed back in the run; after the run it says to start again', async () => {
  const {again, noteTabs, siteLine} = await import('../lib/visits.js');
  const lines = [];
  let tries = 0;
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('flaky') && tries++ === 0) {
      setTimeout(() => noteTabs({ids: [7], boot: 'b2', reading: {[ticket]: 7}}), 5);
      setTimeout(() => { noteTabs({ids: [], boot: 'b2', reading: {}}); again('https://flaky.example'); }, 15);   // closed, then Open again
    } else setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 3, added: 1, pages: 1}), 30);
    return {ok: true};
  };
  const results = await runAll([{name: 'Flaky', url: 'https://flaky.example'}, {name: 'Other', url: 'https://other.example'}],
    {atOnce: 1, openTab, tee: line => lines.push(line), waitMs: 5000, quietMs: 5000, siteMs: 5000});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Flaky', true], ['Other', true]], 'the second reading is the one kept');
  assert.equal(lines.filter(line => line === siteLine('next', 'Flaky', 'https://flaky.example')).length, 2, 'its row is Next again');
  assert.ok(lines.some(line => /2 of 2 · 100%/.test(line)), 'the percent counts it once');
  assert.equal(again('https://flaky.example').ok, false);
});

test('the result says how many jobs fit the search, and the card reads it (owner: "Read 5 jobs, but my Jobs count never grows")', () => {
  const text = resultMessage([{name: 'Indeed', url: 'https://ch.indeed.com/jobs?q=photographe', ok: true, jobs: 5, added: 5, fits: 1},
    {name: 'Glassdoor', url: 'https://www.glassdoor.ch', ok: true, jobs: 3, added: 3, fits: 0}]);
  assert.match(text.split('\n')[1], /· 1 matching your search$/);
  const card = parseVisits(text);
  assert.equal(card.fits, 1);
  assert.match(card.sites[0].detail, /5 jobs \(5 new\), 1 matching your search/);
  assert.equal(parseVisits('🌐 Sites read\nRead 1 of 1 site · 4 jobs (4 new)\n✓ A · 4 jobs (4 new) · https://a.example').fits, null, 'an older result still reads');
});

test('each step a read tab takes shows live in its row, in the words of the page banner, and keeps the site from counting as silent', async () => {
  const {stepOf, siteLine} = await import('../lib/visits.js');
  const {tellStep} = await import('../../extension/visit.js');
  const banners = [], sent = [];
  const runIn = async (tabId, func, args) => { banners.push(args[0]); };
  const send = async (config, route, {body}) => { sent.push([route, JSON.parse(body)]); stepOf(JSON.parse(body)); return {ok: true}; };
  const lines = [];
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    (async () => {
      await tellStep(5, {}, ticket, 'Claude is choosing the filters for your search…', runIn, send);
      for (let i = 0; i < 6; i++) { await new Promise(resolve => setTimeout(resolve, 25)); stepOf({ticket, words: 'Claude is choosing the filters for your search…'}); }   // 150 ms: 3x the quiet time
      await tellStep(5, {}, ticket, 'reading page 1…', runIn, send);
      done({url: url.split('#')[0], ticket, jobs: 6, added: 6, pages: 1});
    })();
    return {ok: true};
  };
  const results = await runAll([{name: 'Hublot', url: 'https://www.hublot.com'}], {openTab, tee: line => lines.push(line), quietMs: 50, siteMs: 5000, waitMs: 5000});
  assert.equal(results[0].ok, true, 'not skipped as silent while Claude chose the filters');
  assert.deepEqual(banners, ['Job Pilotto: Claude is choosing the filters for your search…', 'Job Pilotto: reading page 1…']);
  assert.ok(sent.every(([route, body]) => route === '/extension/visit-state' && body.ticket && body.words));
  assert.ok(lines.includes(siteLine('reading', 'Hublot', 'Claude is choosing the filters for your search…')));
  await tellStep(5, {}, '', 'a tab the person opened', runIn, send);
  assert.equal(sent.length, 2, 'a tab the app did not open tells only its banner');
});

test('employers open on their job page found before the tabs open; portals and unknown sites keep their address', async () => {
  const {withJobPages} = await import('../lib/visits.js');
  let asked = null;
  const runEngine = async (_, args) => {
    asked = JSON.parse((await import('node:fs')).readFileSync(args[2], 'utf8'));
    return {code: 0, stdout: JSON.stringify({ok: true, pages: {'https://www.hublot.com': 'https://www.hublot.com/en-ch/job-offers'}})};
  };
  const lines = [];
  const sites = await withJobPages(null, [{name: 'Hublot', url: 'https://www.hublot.com', kind: 'employer'}, {name: 'Nobody', url: 'https://nobody.example', kind: 'employer'},
    {name: 'Indeed', url: 'https://ch.indeed.com/jobs', kind: 'portal'}], line => lines.push(line), runEngine);
  assert.deepEqual(asked.map(site => site.name), ['Hublot', 'Nobody'], 'portals are not looked up');
  assert.deepEqual(sites.map(site => site.url), ['https://www.hublot.com/en-ch/job-offers', 'https://nobody.example', 'https://ch.indeed.com/jobs']);
  assert.match(lines[0], /Finding the job page of 2 employers/);
});

test('a tab whose Claude is still answering is not skipped as silent, its time is not counted, and a skipped site names its last step', async () => {
  const {whileThinking, stepOf} = await import('../lib/visits.js');
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('thinker')) {   // Claude answers for 150 ms: longer than the quiet time and the site's budget here
      stepOf({ticket, words: 'Claude is learning how to read this site (once)…'});
      whileThinking(ticket, new Promise(resolve => setTimeout(resolve, 150))).then(() => done({url: url.split('#')[0], ticket, jobs: 2, added: 2, pages: 1}));
    } else stepOf({ticket, words: 'reading page 1…'});   // then nothing: skipped, with its last step named
    return {ok: true};
  };
  const results = await runAll([{name: 'Thinker', url: 'https://thinker.example'}, {name: 'Mute', url: 'https://mute.example'}],
    {atOnce: 1, openTab, quietMs: 40, siteMs: 60, waitMs: 5000});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Thinker', true], ['Mute', false]]);
  assert.match(results[1].why, /\(last step: reading page 1\)/);
});

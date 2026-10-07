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
  assert.deepEqual(lines.filter(line => line.includes('▸')), [siteLine('next', 'A', 'https://a.example'), siteLine('opening', 'A', 'Opening in Chrome…'), siteLine('done', 'A', '4 jobs (1 new)')]);
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

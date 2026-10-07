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

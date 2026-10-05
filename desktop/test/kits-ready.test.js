// The "Prepare top matches" message as the card's parts (renderer/kits-ready.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseKitsReady} from '../renderer/kits-ready.js';
import {isFallback} from '../renderer/run-cards.js';

const MESSAGE = ['📝 Application kits ready', '3 drafted for your top matches · nothing sent',
  'Site Reliability Engineer (https://jobs.ashbyhq.com/deepjudge/d8c1)', 'DeepJudge AG',
  'Senior Site Reliability Engineer (x/f/m) (https://job-boards.greenhouse.io/doctolib/jobs/781)', 'Doctolib'].join('\n');

test('a kits message becomes its subtitle and one job per title + company', () => {
  const kits = parseKitsReady(MESSAGE);
  assert.equal(kits.subtitle, '3 drafted for your top matches · nothing sent');
  assert.deepEqual(kits.jobs.map(j => [j.title, j.company]), [['Site Reliability Engineer', 'DeepJudge AG'], ['Senior Site Reliability Engineer (x/f/m)', 'Doctolib']]);
  assert.match(kits.jobs[1].url, /^https:\/\/job-boards/);
});

test('the Telegram form (<a href>) parses the same, and a non-kits message is null', () => {
  const tg = '📝 <b>Application kits ready</b>\n1 drafted\n\n<a href="https://x.io/1">SRE</a>\nAcme';
  assert.equal(parseKitsReady(tg)?.jobs[0].company, 'Acme');
  assert.equal(parseKitsReady('No kit to prepare: every open match already has one.'), null);
});

test('a kits run showing its message as plain text is a fallback finding', () => {
  assert.equal(isFallback('kits', MESSAGE), true);
});

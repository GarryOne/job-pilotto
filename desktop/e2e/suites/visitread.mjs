// "Read the jobs on this page" (7 Oct 2026): the extension's own page functions (extension/visit.js extractPage and goNext, as they run inside
// a page) in a real Chromium on fixture pages, then the engine's reader (src/sources/visits.py) on what they sent. A portal-like list over
// two pages (title, employer, place per card, a Next link), an employer page with job data, and a bot-check page, where it must stop.
// No app window, no Notion, no AI, no network: about ten seconds. What it does not cover: the popup click and Chrome's access prompt.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';

export const name = 'visitread';
export const minutes = 2;
export const light = true;
export const keepGoing = true;

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const fixtures = path.join(import.meta.dirname, '..', 'fixtures', 'visits');
const python = () => process.env.E2E_PYTHON || (fs.existsSync(path.join(repo, '.venv', 'bin', 'python')) ? path.join(repo, '.venv', 'bin', 'python') : 'python3');
// The two functions as the extension injects them: their own source, nothing re-written for the test.
const source = fs.readFileSync(path.join(repo, 'extension', 'visit.js'), 'utf8');
const fn = name => { const match = new RegExp(`export function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(source); if (!match) throw new Error(`${name} not found in extension/visit.js`); return match[0].replace('export ', ''); };
const call = (page, name) => page.evaluate(`(${fn(name).replace(`function ${name}`, 'function')})()`);

export async function run(ctx) {
  const server = http.createServer((req, res) => {
    const file = path.join(fixtures, path.basename(req.url.split('?')[0]) || 'list-1.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(fs.readFileSync(file));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sent = [];
  try {
    await ctx.run('the extension reads a list page as you see it: each card\'s title, address and visible lines', async () => {
      await page.goto(`${base}/list-1.html`);
      const seen = await call(page, 'extractPage');
      sent.push(seen);
      const titles = seen.cards.map(card => card.title);
      if (JSON.stringify(titles) !== JSON.stringify(['Photographe de mode', 'Assistant photographe'])) throw new Error(`cards ${JSON.stringify(titles)}; the menu link must not count`);
      if (!seen.cards[0].lines.includes('Studio Lumière') || seen.challenge || seen.login) throw new Error(`card lines ${JSON.stringify(seen.cards[0].lines)}`);
    });

    await ctx.run('it goes to the next page of the same list, reads it, and finds no page after the last', async () => {
      const how = await call(page, 'goNext');
      if (how !== 'next link' && how !== 'next button') throw new Error(`went on by "${how}"`);
      await page.waitForURL(/list-2\.html/, {timeout: 5000});
      const seen = await call(page, 'extractPage');
      sent.push(seen);
      if (seen.cards.length !== 2) throw new Error(`${seen.cards.length} cards on page 2`);
      const after = await call(page, 'goNext');
      if (after !== 'none') throw new Error(`after the last page it went on by "${after}"`);
    });

    await ctx.run('a bot-check page stops it: nothing read, the person answers it', async () => {
      await page.goto(`${base}/check.html`);
      const seen = await call(page, 'extractPage');
      if (!seen.challenge) throw new Error('the check page was not recognised');
    });

    await ctx.run('the engine keeps the pages of one visit as one feed (three jobs, each with its own employer and place, no duplicate) and reads the job data of an employer page without fetching', async () => {
      await page.goto(`${base}/employer.html`);
      const employer = await call(page, 'extractPage');
      const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-visitread-')), 'visits.json');
      const script = `import json, sys
from unittest import mock
from pathlib import Path
from src.sources import visits, ats
pages, employer, store = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3]
with mock.patch.object(visits, 'STORE', Path(store)), mock.patch.object(visits.careers, 'get_text', side_effect=AssertionError('fetched')):
    results = [visits.read(p['url'].replace('127.0.0.1', 'portal.example'), p['html'], p['cards'], p['title'], session='s1') for p in pages]
    jobs = ats.FETCHERS['visit'](results[-1]['feed'])
    own = visits.read(employer['url'].replace('127.0.0.1', 'jobs.example'), employer['html'], employer['cards'], employer['title'])
print(json.dumps({'added': [r['added'] for r in results], 'jobs': [[j['title'], j.get('employer'), j['location']] for j in jobs],
                  'own': [[j['title'], j['location']] for j in own['jobs']]}))`;
      const out = execFileSync(python(), ['-c', script, JSON.stringify(sent), JSON.stringify(employer), store], {cwd: repo, encoding: 'utf8', env: {...process.env, JOB_PILOTTO_FOLLOW_APP: '0'}});
      const result = JSON.parse(out.trim().split('\n').pop());
      console.log(`    ${JSON.stringify(result)}`);
      if (JSON.stringify(result.added) !== '[2,1]') throw new Error(`new per page ${JSON.stringify(result.added)}, expected 2 then 1 (one card repeats)`);
      const byTitle = Object.fromEntries(result.jobs.map(([title, company, place]) => [title, [company, place]]));
      if (byTitle['Retoucheur photo']?.[0] !== 'Maison Rive' || !/Lausanne/.test(byTitle['Retoucheur photo']?.[1] || '')) throw new Error(`employer and place: ${JSON.stringify(byTitle)}`);
      if (result.own[0]?.[0] !== 'Photographe produit') throw new Error(`the employer page's job data: ${JSON.stringify(result.own)}`);
    });
  } finally {
    await browser.close();
    server.close();
  }
}

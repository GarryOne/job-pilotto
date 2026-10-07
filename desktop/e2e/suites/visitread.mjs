/* global document */
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
const fn = name => { const match = new RegExp(`export function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(source); if (!match) throw new Error(`${name} not found in extension/visit.js`); return match[0].replace('export ', ''); };
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

    await ctx.run('filters: the page\'s own controls are listed for Claude, never Easy Apply, Sign in or Save; its chosen steps are applied, a forbidden one refused', async () => {
      await page.goto(`${base}/filters.html`);
      const controls = await call(page, 'collectControls');
      const labels = controls.map(control => control.label);
      if (labels.some(label => /easy apply|sign in|save/i.test(label))) throw new Error(`a forbidden control was listed: ${JSON.stringify(labels)}`);
      const when = controls.find(control => /date posted/i.test(control.label));
      const remote = controls.find(control => /remote/i.test(control.label));
      const where = controls.find(control => /city/i.test(control.label));
      if (!when || !remote || !where || !when.options.includes('Past week')) throw new Error(`controls ${JSON.stringify(controls)}`);
      // What the engine keeps of Claude's answer (src/ai/visit_filters.py, with a stand-in for the model): only listed controls and offered options.
      const script = `import json, sys
from types import SimpleNamespace
from src.ai import visit_filters
controls = json.loads(sys.argv[1])
answer = {'why': 'recent, Geneva', 'steps': [{'control': sys.argv[2], 'action': 'select', 'value': 'Past week'}, {'control': sys.argv[3], 'action': 'type', 'value': 'Genève'},
  {'control': 'easy', 'action': 'click', 'value': ''}]}
client = SimpleNamespace(messages=SimpleNamespace(create=lambda **k: SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))))
print(json.dumps(visit_filters.plan({'url': 'https://x', 'title': 't', 'controls': controls}, {'role_keywords': ['photographe'], 'locations': {'top_tier': ['Genève']}}, client=client)))`;
      const planned = JSON.parse(execFileSync(python(), ['-c', script, JSON.stringify(controls), when.id, where.id], {cwd: repo, encoding: 'utf8', env: {...process.env, JOB_PILOTTO_FOLLOW_APP: '0'}}).trim().split('\n').pop());
      if (planned.steps.length !== 2) throw new Error(`the engine kept ${JSON.stringify(planned.steps)}: an unlisted control must be dropped`);
      await page.evaluate(() => { document.getElementById('easy').dataset.jpControl = 'sneaky'; });
      const done = await page.evaluate(`(${fn('applyFilters').replace('function applyFilters', 'function')})(${JSON.stringify([...planned.steps, {control: 'sneaky', action: 'click', value: ''}])})`);
      const state = await page.evaluate(() => ({when: document.getElementById('when').value, where: document.getElementById('where').value, applied: document.body.dataset.applied || ''}));
      if (state.when !== 'Past week' || state.where !== 'Genève') throw new Error(`filters not set: ${JSON.stringify(state)}`);
      if (state.applied || done.at(-1).ok) throw new Error('Easy Apply was pressed: it must be refused even when asked');
    });

    await ctx.run('any site: where the quick guess reads nothing, Claude\'s recipe from the page outline reads the jobs and finds the next page', async () => {
      await page.goto(`${base}/odd.html`);
      const guess = await call(page, 'extractPage');
      if (guess.cards.length) throw new Error(`the quick guess read ${guess.cards.length} cards: this page must need the adaptive path`);
      const outline = await call(page, 'pageOutline');
      const tiles = outline.groups.find(group => /tile/.test(group.selector));
      if (!tiles || !outline.pager.some(item => item.label === '→ Suivante')) throw new Error(`outline ${JSON.stringify(outline).slice(0, 400)}`);
      // Claude's answer stands in here; what the engine keeps of it is the real code (src/ai/visit_reader.py).
      const script = `import json, sys
from types import SimpleNamespace
from src.ai import visit_reader
outline = json.loads(sys.argv[1])
answer = {'group': sys.argv[2], 'title': -1, 'company': 1, 'place': 2, 'link': 0, 'next': '→ Suivante', 'why': 'tiles'}
reply = SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))
print(json.dumps(visit_reader.understand(outline, SimpleNamespace(messages=SimpleNamespace(create=lambda **k: reply)))))`;
      const recipe = JSON.parse(execFileSync(python(), ['-c', script, JSON.stringify(outline), tiles.id], {cwd: repo, encoding: 'utf8', env: {...process.env, JOB_PILOTTO_FOLLOW_APP: '0'}}).trim().split('\n').pop());
      const withRecipe = expr => page.evaluate(`(${fn(expr).replace(`function ${expr}`, 'function')})(${JSON.stringify(recipe)})`);
      const cards = await withRecipe('cardsByRecipe');
      if (cards.map(card => card.title).join('|') !== 'Vendeuse confirmée|Conseiller de vente horlogerie|Photographe produit e-shop' || cards[1].lines[1] !== 'Boutique Lac') throw new Error(`cards ${JSON.stringify(cards)}`);
      if (await withRecipe('nextByRecipe') !== 'recipe') throw new Error('the next page was not reached by the recipe');
      await page.waitForURL(/odd-2\.html/, {timeout: 5000});
      const second = await withRecipe('cardsByRecipe');
      if (second.length !== 3) throw new Error(`${second.length} cards on page 2 by the same recipe`);
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

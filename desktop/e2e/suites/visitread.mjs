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
import {chromium} from 'playwright-core';
import {python, pythonEnv} from '../lib/python.mjs';

export const name = 'visitread';
export const minutes = 2;
export const light = true;
export const needsChromium = true;   // CI installs Chromium for it (.github/workflows/e2e.yml)
export const keepGoing = true;

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const fixtures = path.join(import.meta.dirname, '..', 'fixtures', 'visits');
// The two functions as the extension injects them: their own source, nothing re-written for the test.
const source = fs.readFileSync(path.join(repo, 'extension', 'visit.js'), 'utf8');
const fn = name => { const match = new RegExp(`export (?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(source); if (!match) throw new Error(`${name} not found in extension/visit.js`); return match[0].replace('export ', ''); };
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
  // The full Chromium in its new headless mode, as the extension suites run it: CI installs that one, not the separate headless shell.
  const browser = await chromium.launch({headless: false, args: [...(process.env.E2E_HEADED ? [] : ['--headless=new'])]});
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

    await ctx.run('filters: the page\'s own controls are listed for Claude, never Easy Apply, Sign in or Save; only its place step is kept and applied, a forbidden one refused', async () => {
      await page.goto(`${base}/filters.html`);
      const controls = await call(page, 'collectControls');
      const labels = controls.map(control => control.label);
      if (labels.some(label => /easy apply|sign in|save/i.test(label))) throw new Error(`a forbidden control was listed: ${JSON.stringify(labels)}`);
      const when = controls.find(control => /date posted/i.test(control.label));
      const remote = controls.find(control => /remote/i.test(control.label));
      const where = controls.find(control => /city/i.test(control.label));
      if (!when || !remote || !where || !when.options.includes('Past week')) throw new Error(`controls ${JSON.stringify(controls)}`);
      // What the engine keeps of Claude's answer (src/ai/visit_filters.py, with a stand-in for the model): only listed controls, and since 4af2670 (owner, 7 Oct
      // 2026: "filter only by location") only steps for the place: a date step ("for": "other") and an unlisted control are dropped.
      const script = `import json, sys
from types import SimpleNamespace
from src.ai import visit_filters
controls = json.loads(sys.argv[1])
answer = {'why': 'Geneva', 'steps': [{'control': sys.argv[2], 'action': 'select', 'value': 'Past week', 'for': 'other'}, {'control': sys.argv[3], 'action': 'type', 'value': 'Genève', 'for': 'place'},
  {'control': 'easy', 'action': 'click', 'value': '', 'for': 'place'}]}
client = SimpleNamespace(messages=SimpleNamespace(create=lambda **k: SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))))
print(json.dumps(visit_filters.plan({'url': 'https://x', 'title': 't', 'controls': controls}, {'role_keywords': ['photographe'], 'locations': {'top_tier': ['Genève']}}, client=client)))`;
      const planned = JSON.parse(execFileSync(python(), ['-c', script, JSON.stringify(controls), when.id, where.id], {cwd: repo, encoding: 'utf8', env: pythonEnv({JOB_PILOTTO_FOLLOW_APP: '0'})}).trim().split('\n').pop());
      if (planned.steps.length !== 1 || planned.steps[0].value !== 'Genève') throw new Error(`the engine kept ${JSON.stringify(planned.steps)}: only the place step, never a date step or an unlisted control`);
      await page.evaluate(() => { document.getElementById('easy').dataset.jpControl = 'sneaky'; });
      const done = await page.evaluate(`(${fn('applyFilters').replace('function applyFilters', 'function')})(${JSON.stringify([...planned.steps, {control: 'sneaky', action: 'click', value: ''}])})`);
      const state = await page.evaluate(() => ({when: document.getElementById('when').value, where: document.getElementById('where').value, applied: document.body.dataset.applied || ''}));
      if (state.where !== 'Genève') throw new Error(`the place filter was not set: ${JSON.stringify(state)}`);
      if (state.when === 'Past week') throw new Error('a date filter was set: only the place is filtered (4af2670)');
      if (state.applied || done.at(-1).ok) throw new Error('Easy Apply was pressed: it must be refused even when asked');
    });

    await ctx.run('filters: a place typed in a suggest box is picked from its suggestions before the search is sent (Van Cleef, 7 Oct 2026)', async () => {
      await page.goto(`${base}/combobox.html`);
      const controls = await call(page, 'collectControls');
      const box = controls.find(control => control.label === 'Location');
      if (!box) throw new Error(`the suggest box was not listed: ${JSON.stringify(controls)}`);
      const done = await page.evaluate(`(${fn('applyFilters').replace('function applyFilters', 'function')})(${JSON.stringify([{control: box.id, action: 'type', value: 'geneva'}])})`);
      const searched = await page.evaluate(() => document.body.dataset.searched);
      if (done[0]?.picked !== 'Geneva' || searched !== 'Geneva') throw new Error(`picked ${JSON.stringify(done)}, the form sent ${searched}: typed text alone filters nothing`);
    });

    await ctx.run('filters: a plain box with its own suggestion list gets its place picked too, never a link already on the page (7 Oct 2026)', async () => {
      await page.goto(`${base}/plainsuggest.html`);
      const controls = await call(page, 'collectControls');
      const box = controls.find(control => control.label === 'City');
      if (!box) throw new Error(`the box was not listed: ${JSON.stringify(controls)}`);
      const done = await page.evaluate(`(${fn('applyFilters').replace('function applyFilters', 'function')})(${JSON.stringify([{control: box.id, action: 'type', value: 'Geneva'}])})`);
      const state = await page.evaluate(() => ({searched: document.body.dataset.searched, office: document.body.dataset.office || ''}));
      if (done[0]?.picked !== 'Geneva' || state.searched !== 'Geneva' || state.office) throw new Error(`picked ${JSON.stringify(done)}, page ${JSON.stringify(state)}`);
    });

    await ctx.run('a link whose address is template code (DHL, 7 Oct 2026) is never offered to Claude nor followed as the next page', async () => {
      await page.goto(`${base}/unstick.html`);
      await page.evaluate("document.querySelector('nav').insertAdjacentHTML('afterbegin', '<a href=\\'/global/${getUrl(linkEle,\\' onclick=\\'document.body.dataset.broken = 1; return false\\'>Next</a>')");
      const href = await page.evaluate("document.querySelector('nav a').getAttribute('href')");
      if (!href.includes('${getUrl')) throw new Error(`the planted link is ${href}`);
      const ways = await call(page, 'collectWays');
      if (ways.ways.some(way => way.href.includes('getUrl') || way.href.includes('%7BgetUrl'))) throw new Error(`offered: ${JSON.stringify(ways.ways.map(way => way.href))}`);
      await call(page, 'goNext');
      if (await page.evaluate('document.body.dataset.broken')) throw new Error('the template link was clicked as the next page');
    });

    await ctx.run('one posting: its main text is read for "Jobs we couldn\'t read", without the menu or footer; a sign-in page sends only why', async () => {
      await page.goto(`${base}/posting.html`);
      const read = await call(page, 'postingText');
      if (read.blocked || !read.text.startsWith('Client Advisor') || !read.text.includes('Mandarin a plus') || /All jobs|Imprint/.test(read.text) || read.title !== 'Client Advisor - Geneva | Maison') {
        throw new Error(`read ${JSON.stringify(read).slice(0, 400)}`);
      }
      await page.goto(`${base}/posting-login.html`);
      const login = await call(page, 'postingText');
      if (login.blocked !== 'login' || login.text) throw new Error(`sign-in page ${JSON.stringify(login)}`);
    });

    await ctx.run('a job list drawn in a frame by another site is found (not the cookie or video frame), and resetting the filters is never a way on (7 Oct 2026)', async () => {
      await page.route('https://**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: '<html><body>framed</body></html>'}));
      await page.goto(`${base}/framed.html`);
      const frame = await call(page, 'jobFrame');
      await page.unroute('https://**/*');
      if (frame !== 'https://jobs.solique.example/maison/de/') throw new Error(`frame ${frame}`);
      const ways = await call(page, 'collectWays');
      const labels = ways.ways.map(way => way.label);
      if (labels.some(label => /zurücksetzen/.test(label)) || !labels.includes('Weitere Stellen')) throw new Error(`ways ${JSON.stringify(labels)}`);
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
      const recipe = JSON.parse(execFileSync(python(), ['-c', script, JSON.stringify(outline), tiles.id], {cwd: repo, encoding: 'utf8', env: pythonEnv({JOB_PILOTTO_FOLLOW_APP: '0'})}).trim().split('\n').pop());
      const withRecipe = expr => page.evaluate(`(${fn(expr).replace(`function ${expr}`, 'function')})(${JSON.stringify(recipe)})`);
      const cards = await withRecipe('cardsByRecipe');
      if (cards.map(card => card.title).join('|') !== 'Vendeuse confirmée|Conseiller de vente horlogerie|Photographe produit e-shop' || cards[1].lines[1] !== 'Boutique Lac') throw new Error(`cards ${JSON.stringify(cards)}`);
      if (await withRecipe('nextByRecipe') !== 'recipe') throw new Error('the next page was not reached by the recipe');
      await page.waitForURL(/odd-2\.html/, {timeout: 5000});
      const second = await withRecipe('cardsByRecipe');
      if (second.length !== 3) throw new Error(`${second.length} cards on page 2 by the same recipe`);
    });

    await ctx.run('a home page is not a job list: the quick guess says so, and the engine finds the job list from its own links', async () => {
      await page.goto(`${base}/home.html`);
      const seen = await call(page, 'extractPage');
      const plain = fn('plausible').replace('export function plausible', 'function plausible');
      if (await page.evaluate(`(${plain.replace('function plausible', 'function')})(${JSON.stringify(seen.cards)})`)) throw new Error(`the home page looked like a job list: ${JSON.stringify(seen.cards)}`);
      const script = `import json, sys, tempfile, pathlib
from unittest import mock
from src.sources import visits
with mock.patch.object(visits, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'v.json'):
    print(json.dumps(visits.job_page(sys.argv[1], sys.argv[2])))`;
      const found = JSON.parse(execFileSync(python(), ['-c', script, seen.url.replace('127.0.0.1', 'maison-rive.example'), seen.html], {cwd: repo, encoding: 'utf8', env: pythonEnv({JOB_PILOTTO_FOLLOW_APP: '0'})}).trim().split('\n').pop());
      if (!/\/joboffers\/en$/.test(found || '')) throw new Error(`found ${found}, the Careers link expected`);
    });

    await ctx.run('a cookie banner over the list is closed with the least consent offered ("Reject all", not "Accept all"), a sign-in box never touched', async () => {
      await page.goto(`${base}/consent.html`);
      if (!(await page.isVisible('#cookie-banner'))) throw new Error('the fixture\'s banner is not showing: the step would prove nothing');
      const pressed = await call(page, 'closeConsent');
      const state = await page.evaluate('({choice: window.choice || null, signin: !!window.pressedSignIn, banner: !!document.querySelector("#cookie-banner")})');
      if (pressed !== 'Reject all' || state.choice !== 'reject' || state.banner) throw new Error(`pressed "${pressed}", page ${JSON.stringify(state)}`);
      if (state.signin) throw new Error('a box with a password field was pressed');
      if (await call(page, 'closeConsent')) throw new Error('a second call pressed something on a page with no banner left');
    });

    await ctx.run('a consent message drawn in an iframe is closed from inside the frame, with the least consent', async () => {
      await page.goto(`${base}/consent-frame.html`);
      const frame = page.frames().find(each => each !== page.mainFrame());
      if (!frame || !(await frame.isVisible('text=Reject all'))) throw new Error('the fixture\'s framed banner is not showing: the step would prove nothing');
      if (await call(page, 'closeConsent')) throw new Error('the main page pressed something: the banner is in the frame');
      const pressed = await frame.evaluate(`(${fn('closeConsent').replace('function closeConsent', 'function')})()`);
      const choice = await page.evaluate('window.choice || null');
      if (pressed !== 'Reject all' || choice !== 'reject') throw new Error(`pressed "${pressed}" in the frame, choice ${choice}`);
    });

    await ctx.run('a page that draws nothing is seen as blank (said and stopped, not skipped as silent); a list page is not', async () => {
      await page.goto(`${base}/blank.html`);
      if (!(await call(page, 'extractPage')).blank) throw new Error('the blank page was not seen as blank');
      await page.goto(`${base}/list-1.html`);
      if ((await call(page, 'extractPage')).blank) throw new Error('a list page was taken for blank');
    });

    await ctx.run('a page with no job list yet lists its ways on for Claude (never Sign in); the step Claude picks shows the jobs', async () => {
      await page.goto(`${base}/unstick.html`);
      const before = await call(page, 'extractPage');
      if (before.cards.length) throw new Error(`the fixture already shows ${before.cards.length} jobs: the step would prove nothing`);
      const found = await call(page, 'collectWays');
      const labels = found.ways.map(way => way.label);
      if (!labels.includes('See all jobs') || labels.includes('Sign in')) throw new Error(`ways ${JSON.stringify(labels)}`);
      if (!found.text.includes('Discover our open positions')) throw new Error('the page\'s first lines are missing');
      const see = found.ways.find(way => way.label === 'See all jobs');
      const done = await page.evaluate(`(${fn('applyFilters').replace('function applyFilters', 'function')})(${JSON.stringify([{control: see.id, action: 'click', value: ''}])})`);
      const after = await call(page, 'extractPage');
      if (!done[0]?.ok || after.cards.length !== 3) throw new Error(`step ${JSON.stringify(done)}, then ${after.cards.length} jobs`);
    });

    await ctx.run('a second round of ways on never gives one id to two elements: the step Claude names is the one clicked (Fust, 7 Oct 2026)', async () => {
      await page.goto(`${base}/unstick.html`);
      await call(page, 'collectControls');
      await call(page, 'collectWays');
      await page.evaluate("document.querySelector('nav').insertAdjacentHTML('afterbegin', '<a href=\\'/occasionen\\'>Occasionen</a>')");   // the page changed between rounds
      const second = await call(page, 'collectWays');
      const ids = await page.evaluate("[...document.querySelectorAll('[data-jp-control]')].map(node => node.dataset.jpControl)");
      if (new Set(ids).size !== ids.length) throw new Error(`ids given twice: ${JSON.stringify(ids)}`);
      const see = second.ways.find(way => way.label === 'See all jobs');
      const clicked = await page.evaluate(`document.querySelector('[data-jp-control="${see.id}"]').innerText`);
      if (clicked !== 'See all jobs') throw new Error(`id ${see.id} names "${clicked}"`);
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
      const out = execFileSync(python(), ['-c', script, JSON.stringify(sent), JSON.stringify(employer), store], {cwd: repo, encoding: 'utf8', env: pythonEnv({JOB_PILOTTO_FOLLOW_APP: '0'})});
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

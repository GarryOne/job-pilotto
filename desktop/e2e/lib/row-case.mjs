// A pool row's capture becomes a case folder for the recorded-pages job (npm run row-to-case, skill fix-failing-forms): every page scrubbed again (the fake applicant's contact), shrunk
// (lib/row-case-shrink.mjs), the row's model answers (with their part hashes) and presses scrubbed, `baseline` = what the LIVE run did (its evidence lines without times), `replay: "row"` so the recorded test
// replays it on the row path (lib/row-replay.mjs). `expect` stays empty: the proof (row-to-case.mjs) fills it from the new build's replay, never the fixer. Refused, nothing written, when the privacy gate
// (lib/row-case-gates.mjs, the recorded-privacy test's own function) or the size gate fails. Guard: e2e/test/row-case.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {appProfileTexts, personalValues, scrub} from './capture-page.mjs';
import {folderVerdict, privacyFindings, sizeVerdict, CASE_FAIL} from './row-case-gates.mjs';
import {shrinkPages} from './row-case-shrink.mjs';

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const TIME = /^(?:log )?\d\d:\d\d:\d\d(?:\.\d+)?Z? /;   // the evidence lines' own clock
const bare = line => String(line).replace(TIME, '').replace(/^\[extension\]/, '[extension]');

// The live run's evidence as the baseline the OLD build must replay to: page-kind lines in order without their times, each wording once, and what the run reached.
const baselineOf = item => ({pageKinds: [...new Set((item.evidence?.pageKinds || []).map(bare))].map(line => line.replace(/^\[extension\] /, '')), reached: item.run?.reached ?? null,
  filled: item.run?.filled ?? null, short: item.run?.short ?? null, path: item.run?.path || []});

// -> {dir, bytes, verdict}. shrink: injectable for tests (default: the headless-Chromium pruning). values: the person's own values to scrub (default: this Mac's app profile).
export async function buildCase({rowDir, name, outDir, shrink = shrinkPages, values = personalValues(appProfileTexts()), chromium = null, exe}) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(name))) throw new Error(`case name "${name}": use lowercase letters, digits and dashes (<shape>-<n>)`);
  if (!outDir) throw new Error('no cases folder: the private evaluation data is absent (lib/eval-data.mjs casesDir()); nothing written');
  const item = readJson(path.join(rowDir, 'case.json'), null);
  if (!item?.pages?.length) throw new Error(`no recorded pages in ${rowDir}/case.json`);
  const har = readJson(path.join(rowDir, 'styles.har.json'), {log: {entries: []}}).log?.entries || [];
  const harCss = har.filter(entry => /css/.test(entry.response?.content?.mimeType || '')).map(entry => scrub(entry.response.content.text || '', values));
  const pages = item.pages.map(page => ({url: String(page.url).replace(/[?#].*$/, ''), file: page.file, html: scrub(fs.readFileSync(path.join(rowDir, page.file), 'utf8'), values), meta: page}));
  const {pages: shrunk, sheets} = await shrink(chromium || (await import('playwright-core')).chromium, pages.map(({url, file, html}) => ({url, file, html})), harCss, {exe});
  const files = {};
  const meta = item.pages.map((page, at) => ({...Object.fromEntries(['at', 'state', 'ask', 'answerAsk', 'view', 'frameOf'].filter(key => page[key] !== undefined).map(key => [key, page[key]])), url: pages[at].url, file: `pages/${at + 1}.html`}));
  shrunk.forEach((page, at) => { files[meta[at].file] = page.html; });
  files['styles.har.json'] = JSON.stringify({log: {entries: [...sheets].map(([url, text]) => ({request: {url}, response: {content: {mimeType: 'text/css', text}}}))}});
  files['model-memo.json'] = scrub(fs.readFileSync(path.join(rowDir, 'model-memo.json'), 'utf8'), values);
  files['presses.json'] = scrub(fs.readFileSync(path.join(rowDir, 'presses.json'), 'utf8'), values);
  const keep = {shape: item.shape, why: item.why, sample: item.sample, ...(item.control ? {control: item.control} : {})};
  files['case.json'] = `${JSON.stringify({...keep, replay: 'row', pages: meta, baseline: baselineOf(item), expect: {}}, null, 1)}\n`;
  const found = privacyFindings(Object.fromEntries(Object.entries(files).map(([file, text]) => [`${name}/${file}`, text])), values);
  if (found.length) throw new Error(`privacy gate: ${found.join('; ')}; nothing written`);
  const bytes = Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0), verdict = sizeVerdict(bytes);
  if (verdict === 'fail') throw new Error(`size gate: ${name} is ${Math.round(bytes / 1024)} KB, over ${CASE_FAIL / 1024} KB; nothing written`);
  const dir = path.join(outDir, name);
  if (folderVerdict(folderBytes(outDir) + bytes) === 'fail') throw new Error(`size gate: the cases folder would pass 8 MB; nothing written`);
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), text); }
  return {dir, bytes, verdict};
}

const folderBytes = dir => { let total = 0; try { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) total += entry.isDirectory() ? folderBytes(path.join(dir, entry.name)) : fs.statSync(path.join(dir, entry.name)).size; } catch { /* none yet */ } return total; };

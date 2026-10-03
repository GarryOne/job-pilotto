// Reviews the journey's screenshots (artifacts/ui-<view>.png) with AI and writes artifacts/ai-findings.json.
//   E2E_ANTHROPIC_KEY=… node review-ui.mjs        (about $0.01-0.02 a page on Sonnet; the app itself runs on Haiku)
// A request already answered (the same picture, facts, rules and model, byte for byte) is not asked again: its findings come from the
// review cache (E2E_REVIEW_CACHE, kept between CI runs), so an unchanged page costs nothing and its issues are still "seen again".
// Every call's tokens and cost are logged, and the totals written to artifacts/ai-review-usage.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ARTIFACTS, DESKTOP} from './lib/app.mjs';
import {MODEL, buildRequest, fingerprint, parseFindings, usageCost} from './lib/vision.mjs';

const key = process.env.E2E_ANTHROPIC_KEY;
if (!key) { console.error('E2E_ANTHROPIC_KEY is needed.'); process.exit(2); }
const skill = path.resolve(DESKTOP, '..', '.claude', 'skills', 'ui-look-and-feel', 'SKILL.md');
const rules = fs.existsSync(skill) ? fs.readFileSync(skill, 'utf8').replace(/^---[\s\S]*?---/, '') : '';
const CACHE = process.env.E2E_REVIEW_CACHE || path.join(DESKTOP, 'e2e', '.review-cache');
const CACHE_DAYS = 14;   // an answer older than this is asked again (and the file pruned): the reviewer's judgement may have moved on
const all = [];
// A skipped suite (no token yet) or a suite that stopped early leaves nothing to look at: that is not an error.
if (!fs.existsSync(ARTIFACTS) || !fs.readdirSync(ARTIFACTS).some(name => /^(ui|failed)-.+\.png$/.test(name))) { console.log('No screenshots to review.'); process.exit(0); }
fs.mkdirSync(CACHE, {recursive: true});
for (const name of fs.readdirSync(CACHE)) {
  const file = path.join(CACHE, name);
  if (Date.now() - fs.statSync(file).mtimeMs > CACHE_DAYS * 86400000) fs.rmSync(file, {force: true});
}
let rejected = 0;
// Which pages the AI really looked at, and which it could not (no credit, rate limit, an outage): ui-findings reads this. A page nobody reviewed is not a page that came back clean.
const reviewed = [], unreviewed = [];
const usage = {model: MODEL, calls: 0, cached: 0, failed: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0};
const names = fs.readdirSync(ARTIFACTS);
// The pages the journey photographed, and the window at the moment a step failed (at most two): a failure screenshot shows the whole app, the sidebar and the bottom bar too.
const jobs = [...names.filter(name => /^ui-.+\.png$/.test(name)).sort().map(name => ({view: name.slice(3, -4), png: name, factsFile: path.join(ARTIFACTS, `ui-${name.slice(3, -4)}.json`)})),
  ...names.filter(name => /^failed-.+\.png$/.test(name)).sort().slice(0, 2).map(name => ({view: 'failure-screenshot', png: name, factsFile: ''}))];
for (const {view, png, factsFile} of jobs) {
  const file = path.join(ARTIFACTS, png);
  const facts = factsFile && fs.existsSync(factsFile) ? JSON.parse(fs.readFileSync(factsFile, 'utf8')) : null;
  const body = JSON.stringify(buildRequest({view, pngBase64: fs.readFileSync(file).toString('base64'), rules, facts}));
  const cached = path.join(CACHE, `${crypto.createHash('sha256').update(body).digest('hex')}.json`);
  let answer = null, fromCache = false;
  try { answer = JSON.parse(fs.readFileSync(cached, 'utf8')).text; } catch { /* not answered before */ }
  if (typeof answer === 'string') {
    usage.cached++; fromCache = true;
    fs.utimesSync(cached, new Date(), new Date());   // still in use: keep it past CACHE_DAYS
  } else {
    const response = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST',
      headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}, body});
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      usage.failed++;
      // 4xx: our request is wrong (this once hid a deprecated parameter for days): fail the step. 429/5xx: the service is busy, a warning.
      const billing = /credit balance|usage limit|spend limit|rate limit/i.test(detail);   // the test key's own limit: a warning, not a product bug
      if (response.status >= 400 && response.status < 500 && response.status !== 429 && !billing) { console.log(`::error::AI review of ${view} was rejected (HTTP ${response.status}): ${detail}`); rejected++; }
      else console.log(`::warning::AI review of ${view} failed (HTTP ${response.status}): ${detail.slice(0, 160)}; skipped`);
      console.log(`- ${view}: review failed (HTTP ${response.status})`);
      unreviewed.push({view, why: billing ? 'no credit' : `HTTP ${response.status}`});
      continue;
    }
    const data = await response.json();
    const text = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
    const u = data.usage || {};
    const usd = usageCost(MODEL, u);
    usage.calls++;
    usage.input += u.input_tokens || 0; usage.cacheWrite += u.cache_creation_input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0; usage.output += u.output_tokens || 0;
    usage.usd += usd || 0;
    console.log(`  ${view}: ${u.input_tokens || 0} in, ${u.cache_read_input_tokens || 0} cache read, ${u.cache_creation_input_tokens || 0} cache write, ${u.output_tokens || 0} out${usd == null ? '' : ` = $${usd.toFixed(4)}`}`);
    if (data.stop_reason === 'end_turn') fs.writeFileSync(cached, JSON.stringify({view, model: MODEL, text}));   // a cut-off answer is not kept
    answer = text;
  }
  const found = parseFindings(answer, view).map(item => ({...item, id: fingerprint(item), file: png}));   // file: the picture the finding was seen on
  reviewed.push(view);
  console.log(`${found.length ? '!' : '✓'} ${view}: ${found.length} finding(s)${fromCache ? ' (unchanged since an earlier run: not asked again)' : ''}${found.map(item => `\n    [${item.severity}] ${item.title}: ${item.detail}`).join('')}`);
  all.push(...found);
}
fs.writeFileSync(path.join(ARTIFACTS, 'ai-findings.json'), JSON.stringify({model: MODEL, findings: all, reviewed, unreviewed}, null, 2));
fs.writeFileSync(path.join(ARTIFACTS, 'ai-review-usage.json'), JSON.stringify({...usage, usd: Number(usage.usd.toFixed(4))}, null, 2));
const line = `AI review: ${usage.calls} call(s), ${usage.cached} unchanged (not asked again), ${usage.failed} failed; ${usage.input} in + ${usage.cacheRead} cache read + ${usage.cacheWrite} cache write, ${usage.output} out = $${usage.usd.toFixed(4)} (${MODEL})`;
console.log(`\n${all.length} finding(s) written to ai-findings.json\n${line}${unreviewed.length ? `\nNOT reviewed (${unreviewed.map(item => `${item.view}: ${item.why}`).join(', ')}): no finding is filed or cleared for these pages from this run.` : ''}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
if (rejected) process.exit(1);

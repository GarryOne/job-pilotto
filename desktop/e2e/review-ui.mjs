// Reviews the journey's screenshots (artifacts/ui-<view>.png) with AI and writes artifacts/ai-findings.json.
//   E2E_ANTHROPIC_KEY=… node review-ui.mjs        (cost: about $0.01 a page on Haiku)
import fs from 'node:fs';
import path from 'node:path';
import {ARTIFACTS, DESKTOP} from './lib/app.mjs';
import {MODEL, buildRequest, fingerprint, parseFindings} from './lib/vision.mjs';
import {VIEWS} from './lib/uicheck.mjs';

const key = process.env.E2E_ANTHROPIC_KEY;
if (!key) { console.error('E2E_ANTHROPIC_KEY is needed.'); process.exit(2); }
const skill = path.resolve(DESKTOP, '..', '.claude', 'skills', 'ui-look-and-feel', 'SKILL.md');
const rules = fs.existsSync(skill) ? fs.readFileSync(skill, 'utf8').replace(/^---[\s\S]*?---/, '') : '';
const all = [];
for (const view of VIEWS) {
  const file = path.join(ARTIFACTS, `ui-${view}.png`);
  if (!fs.existsSync(file)) continue;
  const response = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST',
    headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
    body: JSON.stringify(buildRequest({view, pngBase64: fs.readFileSync(file).toString('base64'), rules}))});
  if (!response.ok) { console.log(`- ${view}: review failed (HTTP ${response.status})`); continue; }
  const data = await response.json();
  const found = parseFindings(data.content?.[0]?.text, view).map(item => ({...item, id: fingerprint(item)}));
  console.log(`${found.length ? '!' : '✓'} ${view}: ${found.length} finding(s)${found.map(item => `\n    [${item.severity}] ${item.title}: ${item.detail}`).join('')}`);
  all.push(...found);
}
fs.writeFileSync(path.join(ARTIFACTS, 'ai-findings.json'), JSON.stringify({model: MODEL, findings: all}, null, 2));
console.log(`\n${all.length} finding(s) written to ai-findings.json`);

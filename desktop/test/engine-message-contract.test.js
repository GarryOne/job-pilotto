// The engine writes each task's message (src/ai/insights.py); the window reads it back from the run's Notion page (cron_runs.plain
// flattens it). Two copies of one format drift: on 5 Oct 2026 weekly_message moved to the plain layout and parseWeekly still wanted
// emoji headings, so the Search analysis card ran its sections together. These tests run the engine's own writer, not a copy of its text.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {parseWeekly} from '../renderer/weekly-card.js';
import {parseInsight} from '../renderer/insight-card.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fromEngine = code => {
  const run = spawnSync('python3', ['-c', `import json\nfrom src.ai import insights\nfrom src.notion import cron_runs\n${code}`], {cwd: root, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
};

test('the weekly report the engine writes is read back as a card: headline, finding, worked, change, focus', () => {
  const text = fromEngine(`report = {'headline': 'Quiet week: 2 applications', 'finding': 'Replies came from fresh jobs', 'summary': 'You sent 2 applications.',
  'worked': ['Recruiter channel: 5 of 5'], 'change': ['Send the drafted kits', 'Log salary answers'], 'focus': 'Send kits scored 60+'}
print(json.dumps(cron_runs.plain(insights.weekly_message(report, 'https://app.notion.com/p/x'))))`);
  const weekly = parseWeekly(text);
  assert.ok(weekly, `not parsed: ${text}`);
  assert.deepEqual([weekly.headline, weekly.finding, weekly.summary, weekly.worked, weekly.change, weekly.focus],
    ['Quiet week: 2 applications', 'Replies came from fresh jobs', 'You sent 2 applications.', ['Recruiter channel: 5 of 5'], ['Send the drafted kits', 'Log salary answers'], 'Send kits scored 60+']);
});

test('the daily insight the engine writes is read back as a card: evidence, next step, confidence', () => {
  const text = fromEngine(`insight = {'headline': 'Go appears in 40% of roles', 'category': 'Skills', 'basis': 'Jobs', 'confidence': 'Medium', 'sample_size': 12,
  'evidence': ['9 of 12 postings'], 'action': 'Add Go to your CV'}
print(json.dumps(cron_runs.plain(insights.message(insight))))`);
  const insight = parseInsight(text);
  assert.ok(insight, `not parsed: ${text}`);
  assert.deepEqual([insight.headline, insight.evidence, insight.action], ['Go appears in 40% of roles', ['9 of 12 postings'], 'Add Go to your CV']);
});

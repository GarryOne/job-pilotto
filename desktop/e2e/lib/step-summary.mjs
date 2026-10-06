// A suite's steps as a table on the GitHub run's Summary page (6 Oct 2026, owner: "looking at the logs in GitHub Actions there is not much I can understand"): every
// step ✓/✗/skipped, its time, a failure in plain words and the screenshot it left, and where the trace is (lib/app.mjs keeps it only when a step failed). Pure.
import {shotName} from './runner.mjs';

const cell = text => String(text || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const ICON = {passed: '✅', failed: '❌', skipped: '⏭️'};

// results: the runner's [{name, status, seconds, note, retried, budget}]; traces: the trace files kept; artifact: the uploaded artifact's name; runUrl: the run page.
export function stepSummary(suite, results = [], {traces = [], artifact = '', runUrl = '', rerun = false, os = ''} = {}) {
  const count = status => results.filter(result => result.status === status).length;
  const total = results.reduce((sum, result) => sum + (Number(result.seconds) || 0), 0);
  const verdict = count('failed') ? '❌' : '✅';
  const lines = [`### ${verdict} ${suite}${os ? ` (${os})` : ''}${rerun ? ', second try' : ''}: ${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped, ${Math.round(total)} s`, ''];
  if (!results.length) return [...lines, 'No step ran (the suite stopped before its first step: see the log).', ''].join('\n');
  lines.push('| | Step | Time | What happened |', '|---|---|---:|---|');
  for (const result of results) {
    const time = result.seconds ? `${Math.round(Number(result.seconds))} s` : '';
    let what = '';
    if (result.status === 'failed') what = `${cut(cell(result.note), 300)}${result.budget ? '' : ` · screenshot \`${shotName(result.name)}.png\``}`;
    else if (result.status === 'skipped') what = 'skipped: a secret it needs is missing';
    else if (result.retried) what = `passed after one retry (the environment failed: ${cut(cell(result.retried), 120)})`;
    else if (result.faultNeverFired) what = '⚠️ passed, but its planted fault never fired: it may test nothing';
    lines.push(`| ${ICON[result.status] || ''} | ${cut(cell(result.name), 90)} | ${time} | ${what} |`);
  }
  lines.push('');
  if (count('failed') && rerun) lines.push('The second try\'s files are not uploaded: the first try\'s artifact has the screenshots and the trace.', '');
  else if (count('failed')) {
    const where = artifact ? `the **${artifact}** artifact${runUrl ? ` ([download](${runUrl}#artifacts))` : ''}` : 'the artifacts folder';
    lines.push(`Screenshots and logs: ${where}.`);
    if (traces.length) lines.push(`Trace (every action with its screenshot, the page before and after, console and network): ${traces.map(name => `\`${name}\``).join(', ')} in the same artifact. Unzip the artifact, then drag the trace onto https://trace.playwright.dev (it runs in your browser, nothing is uploaded) or run \`npx playwright show-trace <file>\`.`);
    lines.push('');
  }
  return lines.join('\n');
}

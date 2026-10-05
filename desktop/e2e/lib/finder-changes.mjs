// What changed in the Finder each day, and how big it was, so the page /self-heal can set it beside what the Finder filed that day.
// Read from git (self-heal-stats.yml checks out the whole history); a change is a commit that touches the Finder's own files.
import {execFileSync} from 'node:child_process';

export const FINDER_PATHS = ['desktop/e2e', '.github/workflows/ui-findings.yml', '.github/workflows/ui-verdict.yml', '.github/workflows/ui-fixer.yml', '.github/workflows/judge-exam.yml', '.github/workflows/tracker-sync.yml', '.github/workflows/self-heal-stats.yml', '.github/workflows/e2e.yml'];
export const SIZES = [[1, 'tests only'], [60, 'small'], [300, 'medium'], [Infinity, 'large']];   // lines of rules or suite code changed, tests and fixtures not counted

export const isTest = file => /(^|\/)(test|fixtures)\//.test(file) || /\.test\.m?js$/.test(file);
export const kindOf = file => (isTest(file) ? 'tests' : /\/suites\//.test(file) ? 'suite' : 'rules');
export const sizeOf = lines => (lines <= 0 ? 'tests only' : lines < 60 ? 'small' : lines < 300 ? 'medium' : 'large');

// `git log --format=@@%h|%aI|%s --numstat` -> one entry per commit with the lines it changed in rules/suite code and in tests.
export function parseLog(text = '') {
  const commits = [];
  for (const line of String(text).split('\n')) {
    if (line.startsWith('@@')) {
      const [sha, at, ...rest] = line.slice(2).split('|');
      commits.push({sha, day: at.slice(0, 10), subject: rest.join('|').trim(), rules: 0, suite: 0, tests: 0, files: 0});
    } else if (commits.length && /^(\d+|-)\t(\d+|-)\t/.test(line)) {
      const [added, removed, file] = line.split('\t'), n = (Number(added) || 0) + (Number(removed) || 0), last = commits[commits.length - 1];
      last[kindOf(file)] += n; last.files++;
    }
  }
  return commits.map(item => ({...item, lines: item.rules + item.suite, size: sizeOf(item.rules + item.suite)}));
}

// Per day: how many changes, how many lines, the biggest ones by name.
export function byDay(commits, {top = 8} = {}) {
  const days = {};
  for (const item of commits) {
    const day = (days[item.day] ??= {day: item.day, commits: 0, rules: 0, suite: 0, tests: 0, files: 0, items: []});
    day.commits++; day.rules += item.rules; day.suite += item.suite; day.tests += item.tests; day.files += item.files;
    day.items.push({sha: item.sha, subject: item.subject.slice(0, 100), lines: item.lines, size: item.size});
  }
  return Object.values(days).sort((a, b) => a.day.localeCompare(b.day)).map(day => {
    const items = day.items.sort((a, b) => b.lines - a.lines);
    return {...day, lines: day.rules + day.suite, size: sizeOf(day.rules + day.suite), items: items.slice(0, top), more: Math.max(0, items.length - top)};
  });
}

export function collectChanges({since = '2026-10-02', run = args => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024})} = {}) {
  try { return byDay(parseLog(run(['log', `--since=${since}`, '--no-merges', '--format=@@%h|%aI|%s', '--numstat', '--', ...FINDER_PATHS]))); } catch { return []; }
}

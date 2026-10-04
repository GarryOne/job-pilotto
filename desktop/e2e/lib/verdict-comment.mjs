// The comment the verdict pass leaves on an issue: a verdict banner, why, the evidence (file:line), and what happens next, laid out so it reads at a glance (owner, 4 Oct 2026: the
// plain paragraph was hard to read). Pure: verdict-comment.mjs reads the model's file, this renders. The first line is a hidden marker the loop's own code reads back (verdict word),
// since the visible text is decorated.
export const MARK = /^<!-- ui-loop-verdict:([a-z-]+) -->/;

const BANNER = {
  real: {alert: 'IMPORTANT', icon: '✅', title: 'Real — confirmed', line: 'The verdict pass read the code and the screenshot and says this is a real problem. It is marked `confirmed`.',
    next: 'The fixer takes it once it is switched on. A person can also fix it now.'},
  'false-positive': {alert: 'NOTE', icon: '🚫', title: 'Not a bug — closed', line: 'The verdict pass says this works as designed, or would not cost a job seeker anything.',
    next: 'Closed as not planned and marked `wontfix-auto`, so the Finder does not file it again. Reopen it if you disagree.'},
  harness: {alert: 'NOTE', icon: '🧪', title: 'Test problem — closed', line: 'The finding comes from the test (its data, environment or wait), not from the product.',
    next: 'Closed with the `harness` label. The weekly Finder self-review reads these and fixes the test.'},
  'needs-human': {alert: 'WARNING', icon: '🙋', title: 'Needs a person', line: 'The verdict pass could not decide this one alone.',
    next: 'Check the point under "Why", then label it `confirmed` (to fix it) or close it. It stays on the Top issues list, marked.'},
};

const REF = /(^|[\s(])((?:desktop|src|tests|tools|extension|\.github)\/[\w./-]+\.\w+(?::\d+(?:-\d+)?)?)(?=[\s,;:.)]|$)/g;
const code = text => String(text || '').replace(REF, (all, lead, ref) => `${lead}\`${ref}\``);
export const refsIn = text => [...new Set([...String(text || '').matchAll(/((?:desktop|src|tests|tools|extension|\.github)\/[\w./-]+\.\w+(?::\d+(?:-\d+)?)?)/g)].map(match => match[1]))];

// The model writes the verdict word, then a few lines; "Why:" and "Check:" are labels it is asked to use, anything else is the reason.
export function parse(raw) {
  const lines = String(raw || '').split('\n'), word = (lines[0] || '').trim().toLowerCase().replace(/[^a-z-]/g, '');
  const out = {word, why: '', check: ''};
  let at = 'why';
  for (const line of lines.slice(1)) {
    const m = line.match(/^\s*(Why|Check|Reason)\s*:\s*(.*)$/i);
    if (m) { at = /^check/i.test(m[1]) ? 'check' : 'why'; out[at] = `${out[at]} ${m[2]}`.trim(); continue; }
    if (line.trim()) out[at] = `${out[at]} ${line.trim()}`.trim();
  }
  return out;
}

// A `real` verdict rests on code the model read: when none of the files it cites exists (or the line is past the file's end), it was guessing where the bug is
// (#267 cited strategy-review.js; the text lives in activity.js), so a person looks instead of the fixer going to the wrong file. `exists(path)` returns the file's line count, or 0.
export function checkEvidence(raw, lines) {
  const {word, why} = parse(raw);
  if (word !== 'real') return {word, note: ''};
  const refs = refsIn(why);
  const found = refs.filter(ref => { const [file, line] = ref.split(':'); const count = lines(file); return count > 0 && (!line || Number(line.split('-')[0]) <= count); });
  if (found.length) return {word, note: ''};
  return {word: 'needs-human', note: refs.length ? `Its cited code (${refs.join(', ')}) does not exist, so the verdict was not trusted.` : 'It cited no file and line, so the verdict was not trusted.'};
}

export function verdictComment(raw, {number = 0} = {}) {
  const {word, why, check} = parse(raw);
  const key = BANNER[word] ? word : 'needs-human';
  const b = BANNER[key];
  const refs = refsIn(`${why} ${check}`);
  return [
    `<!-- ui-loop-verdict:${key} -->`,
    `> [!${b.alert}]`,
    `> ### ${b.icon} Verdict: ${b.title}`,
    `> ${b.line}`,
    '',
    '### 🧠 Why',
    code(why) || '_The verdict pass wrote no reason._',
    ...(key === 'needs-human' && check ? ['', '### 🔎 What a person should check', code(check)] : []),
    ...(refs.length ? ['', '### 📍 Evidence', '| Where in the code |', '|---|', ...refs.map(ref => `| \`${ref}\` |`)] : []),
    '',
    '### ➡️ What happens next',
    b.next,
    '',
    `<sub>UI loop · verdict pass · read-only, it changed no code${number ? ` · #${number}` : ''}</sub>`,
  ].join('\n');
}

// What a decorated verdict comment says, for code that reads comments back (the Why section; the old plain comments are returned as they are).
export function whyOf(body) {
  const text = String(body || '');
  if (!MARK.test(text)) return text;
  const m = /### 🧠 Why\n([\s\S]*?)(?:\n\n###|\n\n<sub>|$)/.exec(text);
  return (m ? m[1] : text).replace(/`/g, '').trim();
}

// The daily build digest ("what we built today", spec docs/superpowers/specs/2026-10-16-daily-digest.md): the pure parts. A day's merged PRs are cut down to a few lines each,
// Haiku groups them by goal and answers a FIXED JSON shape, and this file validates that answer and writes the markdown (the intro and the PR numbers are code's, never the AI's).
// Used by tools/daily-digest.mjs (CI) and the admin page. Guard: test/build-digest.test.js (a fixture of the 16 Oct 2026 PRs, no live AI).
export const MODEL = 'claude-haiku-5-5';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The calendar day in Zurich (YYYY-MM-DD): the day of the digest, whatever the server clock says.
export const zurichDay = date => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
export const dayWords = day => { const [, month, dd] = day.split('-'); return `${Number(dd)} ${MONTHS[Number(month) - 1]}`; };

const plain = text => String(text || '').replace(/^[#>*\s-]+/, '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
const section = (body, heading) => {
  const lines = String(body || '').split('\n'), start = lines.findIndex(line => line.startsWith('###') && line.includes(heading));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) { if (/^(---|###)/.test(line)) break; out.push(line); }
  return out;
};

// One PR cut down for the prompt: title, the verdict line, the "What changed" bullets, the first Before→After row (≤ 400 characters in all).
export function summarize(pr) {
  const title = plain(String(pr.title || '').replace(/^\[[^\]]+\]\s*/, ''));
  const verdict = plain(String(pr.body || '').split('\n').find(line => line.trim()) || '');
  const changes = section(pr.body, 'What changed').filter(line => line.trim().startsWith('-')).map(line => plain(line.replace(/^\s*-\s*✅?/, ''))).slice(0, 4);
  const row = section(pr.body, 'Before').find(line => /^\|/.test(line) && !/^\|[\s:|-]+\|?$/.test(line) && !/What/.test(line.split('|')[1] || '') && !/Before/.test(line));
  const cells = row ? row.split('|').slice(1, -1).map(plain) : [];
  const delta = cells.length >= 3 ? `${cells[0]}: ${cells[1]} -> ${cells[2]}` : '';
  const text = [verdict !== title ? verdict : '', ...changes, delta].filter(Boolean).join(' | ').slice(0, 400);
  return {number: pr.number, title, text, mergedAt: pr.mergedAt};
}

export const SYSTEM = `You write the owner's daily build digest for Job Pilotto, a job-search app. You get the PRs merged today (number, title, short notes). Group them by GOAL (what the owner was working towards),
not by file. Plain words a non-engineer understands; no jargon, no session names, no PR titles copied. Answer ONLY a JSON object:
{"groups":[{"emoji":"🧭","title":"Apply flow on real ATS sites","bullets":[{"lead":"Short bold lead","text":"One plain sentence on what changed for the user, with a measured number when the notes have one.","prs":[1000,1001]}]}],"open":"One line of what is still open."}
Rules: 3 to 9 groups, 2 to 5 bullets each, lead up to 8 words, text up to 220 characters, one emoji per group. "prs" lists only numbers from the input. Put every PR in some bullet. "open" comes from the open PRs list (up to 220 characters; say "Nothing open." if the list is empty).`;

export function buildPrompt(summaries, open = []) {
  const merged = summaries.map(item => `#${item.number} ${item.title} :: ${item.text}`).join('\n');
  const waiting = open.slice(0, 15).map(item => `#${item.number} ${plain(String(item.title).replace(/^\[[^\]]+\]\s*/, ''))}`).join('\n') || '(none)';
  return {system: SYSTEM, user: `Merged today:\n${merged}\n\nOpen PRs (not merged yet):\n${waiting}`};
}

const short = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

// The AI's answer -> {groups, open, dropped}, or {error}. Unknown PR numbers are dropped, a bullet with none left is dropped, PRs the AI forgot go under "Smaller changes".
export function validate(answer, numbers) {
  let data = answer;
  if (typeof answer === 'string') {
    const match = answer.match(/\{[\s\S]*\}/);
    try { data = JSON.parse(match ? match[0] : answer); } catch { return {error: 'not JSON'}; }
  }
  if (!data || !Array.isArray(data.groups)) return {error: 'no groups'};
  const known = new Set(numbers), seen = new Set();
  let dropped = 0;
  const groups = [];
  for (const group of data.groups.slice(0, 9)) {
    const emoji = String(group?.emoji || '').trim(), title = short(group?.title, 60), bullets = [];
    if (!emoji || emoji.length > 8 || !title || !Array.isArray(group.bullets)) { dropped++; continue; }
    for (const bullet of group.bullets.slice(0, 5)) {
      const prs = [...new Set((Array.isArray(bullet?.prs) ? bullet.prs : []).map(Number).filter(n => known.has(n)))].sort((a, b) => a - b);
      const lead = short(bullet?.lead, 70), text = short(bullet?.text, 240);
      if (!lead || !text || !prs.length) { dropped++; continue; }
      prs.forEach(n => seen.add(n));
      bullets.push({lead, text, prs});
    }
    if (bullets.length) groups.push({emoji, title, bullets});
  }
  if (!groups.length) return {error: 'no usable group'};
  const missing = numbers.filter(n => !seen.has(n)).sort((a, b) => a - b);
  if (missing.length) groups.push({emoji: '🧩', title: 'Smaller changes', bullets: [{lead: 'Tidy-ups and small fixes', text: 'Smaller changes that fit no goal above.', prs: missing}]});
  return {groups, open: short(data.open, 240) || 'Nothing open.', dropped};
}

// [972, 973, 974, 980] -> "#972-#974, #980": runs of 3 or more become a range.
export function prList(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b), parts = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`#${sorted[i]}-#${sorted[j]}`); else for (let k = i; k <= j; k++) parts.push(`#${sorted[k]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

export const countOf = numbers => ({count: numbers.length, min: numbers.length ? Math.min(...numbers) : 0, max: numbers.length ? Math.max(...numbers) : 0});

export function render({day, groups, open, numbers}) {
  const {count, min, max} = countOf(numbers);
  const intro = count ? `Here's what we achieved on ${dayWords(day)}, grouped by goal. About ${count} PR${count === 1 ? '' : 's'} merged, from #${min} to #${max}.` : `Nothing was merged on ${dayWords(day)}.`;
  const body = groups.map(group => `${group.emoji} **${group.title}**\n${group.bullets.map(bullet => `- **${bullet.lead}.** ${bullet.text} (${prList(bullet.prs)})`).join('\n')}`).join('\n\n');
  return `${intro}\n\n${body}${body ? '\n\n' : ''}**Still open:** ${open || 'Nothing open.'}\n`;
}

// Ask the model (fetch is injected, a test passes a fake). -> {text, usage} of the Messages API; throws on a non-2xx.
export async function ask({system, user}, {key, model = MODEL, fetch: doFetch = fetch, maxTokens = 3000}) {
  const response = await doFetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01'},
    body: JSON.stringify({model, max_tokens: maxTokens, system, messages: [{role: 'user', content: user}]})});
  if (!response.ok) throw new Error(`model answered ${response.status}`);
  const out = await response.json();
  return {text: (out.content || []).map(part => part.text || '').join(''), usage: out.usage || {}};
}

// The whole step: summaries + open PRs -> {markdown, groups, numbers, usage} (one retry on a bad answer), or throws.
export async function makeDigest({day, prs, open = [], key, model, fetch: doFetch}) {
  const summaries = prs.map(summarize), numbers = summaries.map(item => item.number);
  if (!numbers.length) return {markdown: render({day, groups: [], open: '', numbers}), groups: [], open: '', numbers, usage: {}};
  const prompt = buildPrompt(summaries, open);
  const usage = {input_tokens: 0, output_tokens: 0};
  let failure = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const {text, usage: used} = await ask(prompt, {key, model, fetch: doFetch});
    usage.input_tokens += used.input_tokens || 0; usage.output_tokens += used.output_tokens || 0;
    const checked = validate(text, numbers);
    if (!checked.error) return {markdown: render({day, groups: checked.groups, open: checked.open, numbers}), groups: checked.groups, open: checked.open, numbers, usage};
    failure = checked.error;
  }
  throw new Error(`the model's answer was unusable twice (${failure})`);
}

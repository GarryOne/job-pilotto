// The "Prepare top matches" message as the card's parts. src/daily.py (--mode kits) writes it as:
//
//   📝 Application kits ready
//   3 drafted for your top matches · nothing sent
//
//   Site Reliability Engineer (https://jobs.example.com/1)     <- the job's title, its link in brackets (Notion flattens <a>)
//   DeepJudge AG                                               <- its company
//   …
//
// Drawn on the insight card's shape like every other task's result, not as the Telegram text it was written as (5 Oct 2026).
// Nothing is re-worded; a message that is not a kits list returns null, so its plain text still shows.
const HEAD = /^\p{Extended_Pictographic}?️?\s*(Application kits|Tailored CVs) ready\s*$/u;   // a Prepare run's kits, or a Tailor CVs run's CVs: one card shape
const TITLE = /^(.*?)\s*\((https?:\/\/[^)\s]+)\)\s*$/;

export function parseKitsReady(message) {
  const lines = String(message || '').replace(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)').replace(/<\/?(?:b|i|u|s|code|pre)\b[^>]*>/gi, '')
    .split('\n').map(line => line.trim()).filter(Boolean);
  const head = lines.findIndex(line => HEAD.test(line));
  if (head < 0) return null;
  const what = HEAD.exec(lines[head])[1] === 'Tailored CVs' ? 'cv' : 'kit';
  const subtitle = lines[head + 1] || '';
  const jobs = [];
  for (const line of lines.slice(head + 2)) {
    const title = TITLE.exec(line);
    if (title) jobs.push({title: title[1], url: title[2], company: ''});
    else if (jobs.length && !jobs[jobs.length - 1].company) jobs[jobs.length - 1].company = line;
  }
  return jobs.length ? {what, subtitle, jobs} : null;
}

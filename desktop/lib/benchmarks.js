// What applications typically get on a job board, from the website's counts of how people's applications went (site/src/knowledge.js benchmarks).
// Fetched with the alias pack (lib/aliases.js), kept in data/benchmarks.json, and shown on an applied job's menu as one line. Nothing about the
// user goes up for this; what comes down is a share and a coarse number of days per known job board.
const FILE = 'data/benchmarks.json';
const DAYS = ['0-3', '4-7', '8-14', '15-30', '31+'];
const NAMES = {greenhouse: 'Greenhouse', ashby: 'Ashby', lever: 'Lever', workable: 'Workable', smartrecruiters: 'SmartRecruiters', recruitee: 'Recruitee', personio: 'Personio', teamtailor: 'Teamtailor', workday: 'Workday', successfactors: 'SuccessFactors', join: 'Join', umantis: 'Umantis'};

export const clean = list => (Array.isArray(list) ? list : []).filter(item => NAMES[item?.board] && Number(item.n) >= 30 && Number(item.heard) >= 0 && Number(item.heard) <= 1 && (item.days === '' || DAYS.includes(item.days)))
  .slice(0, 12).map(item => ({board: item.board, n: Math.round(Number(item.n)), heard: Math.round(Number(item.heard) * 100) / 100, days: item.days || ''}));

export function save(storage, list, now = Date.now()) {
  storage.writeText(FILE, JSON.stringify({at: now, boards: clean(list)}));
}

// -> {url: "Typical on Greenhouse: 38% hear back, usually within 4–7 days"} for the urls whose board has a benchmark.
export function lines(storage, urls, boardName) {
  let kept = null;
  try { kept = JSON.parse(storage.readText(FILE) || 'null'); } catch { kept = null; }
  const byBoard = new Map(clean(kept?.boards).map(item => [item.board, item]));
  const out = {};
  for (const url of Array.isArray(urls) ? urls.slice(0, 2000) : []) {
    let host = '';
    try { host = new URL(String(url)).hostname; } catch { continue; }
    const item = byBoard.get(boardName(host));
    if (!item) continue;
    out[url] = `Typical on ${NAMES[item.board]}: ${Math.round(item.heard * 100)}% hear back${item.days ? `, usually within ${item.days.replace('-', '–').replace('31+', '31+')} days` : ''} (${item.n} applications)`;
  }
  return out;
}

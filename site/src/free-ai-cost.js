// /admin/ai-cost: what Free AI (Workers AI, site/src/free-ai.js) costs us, from the relay's own per-step log (ai_calls, src/aicost.js), shown beside the
// jobs' Claude and OpenAI spend: it is not billed by Anthropic, so it stays out of their total. Counts and money only, per step.
import {FREE_NEURONS_PER_DAY, neuronsOf} from './free-ai-models.js';
import {LIMITS} from './free-ai.js';
const esc = text => String(text).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const money = n => `$${(Number(n) || 0).toFixed(n && n < 0.1 ? 4 : 2)}`;

// rows: {day, who, action, model, calls, tokens_in, tokens_out, micro_usd} from ai_calls, Workers AI models only ('@cf/…').
export function freeSummary(rows, now = new Date(), days = 30) {
  const today = now.toISOString().slice(0, 10), from = new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const mine = rows.filter(row => String(row.model).startsWith('@cf/') && row.day >= from);
  const steps = {};
  let usd = 0, calls = 0, todayUsd = 0, todayCalls = 0;
  const installs = new Set(), todayInstalls = new Set(), month = today.slice(0, 7), mine_ = {};
  let monthUsd = 0;
  for (const row of mine) {
    const cost = (row.micro_usd || 0) / 1e6;
    const step = steps[row.action] ||= {action: row.action, calls: 0, usd: 0, tokensIn: 0, tokensOut: 0};
    step.calls += row.calls; step.usd += cost; step.tokensIn += row.tokens_in || 0; step.tokensOut += row.tokens_out || 0;
    usd += cost; calls += row.calls; installs.add(row.who);
    if (row.day.startsWith(month)) { monthUsd += cost; (mine_[row.who] ||= {who: row.who, day: 0, month: 0}).month += cost; }   // per install: use today and this month (the id is a digest, no personal data)
    if (row.day === today) { (mine_[row.who] ||= {who: row.who, day: 0, month: 0}).day += cost; todayUsd += cost; todayCalls += row.calls; todayInstalls.add(row.who); }
  }
  const todayNeurons = Math.round(neuronsOf(todayUsd));
  return {todayNeurons, allowancePct: Math.round(100 * todayNeurons / FREE_NEURONS_PER_DAY), days, usd, calls, installs: installs.size, todayUsd, todayCalls, todayInstalls: todayInstalls.size,
    perInstallToday: todayInstalls.size ? todayUsd / todayInstalls.size : 0, monthUsd, perInstall: Object.values(mine_).sort((a, b) => b.month - a.month || b.day - a.day), steps: Object.values(steps).sort((a, b) => b.usd - a.usd)};
}

// The trial installs' lifetime use (KV freeai:life:<install>, written by free-ai.js; a licence key never has one) -> how many are near (80%) or at the trial budget. Install ids only.
export async function trialUse(kv, budgetUsd = LIMITS.trialUsd) {
  try {
    const keys = (await kv.list({prefix: 'freeai:life:'})).keys || [];
    const used = await Promise.all(keys.slice(0, 500).map(async key => ({who: key.name.split(':')[2].slice(0, 8), usd: (Number(await kv.get(key.name)) || 0) / 1e6})));
    return {budgetUsd, installs: used.length, near: used.filter(row => row.usd >= 0.8 * budgetUsd && row.usd < budgetUsd).length, at: used.filter(row => row.usd >= budgetUsd).length, top: used.sort((a, b) => b.usd - a.usd).slice(0, 10)};
  } catch { return null; }
}

export function freeSection(summary, label, accountNeurons = null, trial = null) {
  const rows = summary.steps.map(step => `<tr><td>${esc(step.action)}</td><td class="n">${step.calls}</td><td class="n">${step.tokensIn + step.tokensOut}</td><td class="n">${money(step.usd)}</td><td class="n">${money(step.calls ? step.usd / step.calls : 0)}</td></tr>`).join('');
  return `<section class="card"><h2>🆓 Free AI (Workers AI)</h2><small class="muted">Not billed by Anthropic: counted by the site's relay, per step. Today ${summary.todayNeurons} of ${FREE_NEURONS_PER_DAY} neurons (${summary.allowancePct}%) of the free plan · ${money(summary.todayUsd)} · ${summary.todayCalls} calls · ${summary.todayInstalls} installs (${money(summary.perInstallToday)} each)${accountNeurons == null ? '' : ` · Account today: ${Math.round(accountNeurons)} neurons (from Cloudflare)`}</small>
${trial ? `<p class="muted">Trial budget $${trial.budgetUsd} per install, for life: ${trial.at} at it, ${trial.near} near it (80%+), of ${trial.installs} with use</p>` : ''}
<p class="muted">This month ${money(summary.monthUsd)} of $${LIMITS.monthStopUsd} (alert at $${LIMITS.monthAlertUsd}) · per install: $${LIMITS.installDayUsd} a day, $${LIMITS.installMonthUsd} a month</p>
${summary.perInstall.length ? `<div class="wrap"><table><tr><th>Install</th><th>Today</th><th>of $${LIMITS.installDayUsd}</th><th>This month</th><th>of $${LIMITS.installMonthUsd}</th></tr>${summary.perInstall.slice(0, 30).map(row => `<tr><td>${esc(row.who)}</td><td class="n">${money(row.day)}</td><td class="n">${Math.round(100 * row.day / LIMITS.installDayUsd)}%</td><td class="n">${money(row.month)}</td><td class="n">${Math.round(100 * row.month / LIMITS.installMonthUsd)}%</td></tr>`).join('')}</table></div>` : ''}
${summary.calls ? `<div class="wrap"><table><tr><th>Step</th><th>Calls · ${esc(label.toLowerCase())}</th><th>Tokens</th><th>Cost</th><th>Per call</th></tr>${rows}
<tr class="total"><td>Total</td><td class="n">${summary.calls}</td><td class="n">${summary.steps.reduce((n, s) => n + s.tokensIn + s.tokensOut, 0)}</td><td class="n">${money(summary.usd)}</td><td class="n">${money(summary.calls ? summary.usd / summary.calls : 0)}</td></tr></table></div>` : '<p class="muted">No Free AI calls yet.</p>'}</section>`;
}

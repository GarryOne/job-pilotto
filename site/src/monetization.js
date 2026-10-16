// /admin/monetization (owner, 16 Oct 2026): Free vs Pro in five seconds: the verdict tiles (installs, trials completed, activated, Pro buyers, conversion with its colour), the funnel bars,
// the AI cost per free and per Pro user, and the money once the Pro tables exist. The numbers are src/monetization-data.js; the lines and fixed costs are src/monetization-config.js. Counts only, never an e-mail.
import {viewer} from './auth.js';
import {filterLinks} from './admin.js';
import {esc, remember} from './stats.js';
import {BARS_CSS, barRows, legend} from './day-bars.js';
import {collect, RANGES, rangeOf} from './monetization-data.js';
import {PROJECTIONS_URL, TRIAL_MIN_FOR_VERDICT} from './monetization-config.js';

const n = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const usd = value => `$${(Number(value) || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const pct = value => `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
const DOT = {green: '🟢', yellow: '🟡', red: '🔴', grey: '⚪'};

function tiles({funnel, conversion}) {
  const tile = (label, value, note) => `<section class="card tile"><span class="muted">${label}</span><b>${value}</b><span class="muted">${note}</span></section>`;
  return `<div class="tiles">${tile('Signups', n(funnel.setup), 'installs that finished setup (not downloads)')}
${tile('Trials completed', n(funnel.trials), '20 applications or 60 days reached')}
${tile('Activated', n(funnel.activated), 'reached a first application')}
${tile('Pro buyers', n(funnel.pro), 'of these installs')}
<section class="card tile verdict ${conversion.colour}"><span class="muted">Conversion ${DOT[conversion.colour]}</span><b>${funnel.trials ? pct(conversion.ofTrials) : '–'}</b>
<span class="muted">Pro ÷ trials completed · ${esc(conversion.note)} · ${funnel.setup ? pct(conversion.ofSignups) : '–'} of signups</span></section></div>`;
}

// The whole way, one step per row; the bar is the step against the largest step, the right-hand text the drop from the step before ("–" when a step is larger, e.g. installs that never came through the website).
export function funnelBars({funnel}) {
  const steps = [['Download clicks', funnel.downloads], ['First run', funnel.installs], ['Signup: setup finished', funnel.setup], ['Activated: first application', funnel.activated], ['Trial completed', funnel.trials], ['Pro', funnel.pro]];
  const top = Math.max(...steps.map(([, count]) => count));
  const segments = [{id: 'reached', label: 'reached this step', color: '#5ec4b6'}, {id: 'left', label: 'did not (yet)', color: '#3a424b'}];
  if (!top) return '<p class="muted">No downloads or installs in this period.</p>';
  const list = steps.map(([label, count], i) => ({label, title: label, count, drop: i && steps[i - 1][1] >= count && steps[i - 1][1] ? 1 - count / steps[i - 1][1] : null, counts: {reached: count, left: top - count}}));
  return `${legend(segments)}${barRows(segments, list, row => `${n(row.count)} · ${row.drop === null ? (row.label === 'Download clicks' ? 'website' : '–') : `−${pct(row.drop)}`}`)}`;
}

function costCard({cost}) {
  const row = (label, value, note = '') => `<tr><td>${label}</td><td class="num">${value}</td><td class="muted">${note}</td></tr>`;
  const line = cost.month.cap ? cost.month.usd / cost.month.cap : 0;
  return `<section class="card"><h2>AI cost</h2><table><tr><th>Who</th><th class="num">Figure</th><th></th></tr>
${row('Free user, average', usd(cost.free.average), `${n(cost.free.users)} users with AI use`)}${row('Free user, median', usd(cost.free.median))}
${row('Free users at the lifetime cap', n(cost.free.atCap), `the ${usd(cost.trialUsd)} per install`)}
${row('Pro user, average (credit used)', usd(cost.pro.average), `${n(cost.pro.users)} Pro users with AI use`)}
${row('All AI cost in this period', usd(cost.total), 'free + Pro + founders')}
${row('This month, Free AI', `${usd(cost.month.usd)} of ${usd(cost.month.cap)}`, `${pct(line)} of the cap`)}</table></section>`;
}

function moneyCard({money, fixedCosts}) {
  if (!money) return `<section class="card"><h2>Money</h2><p class="muted">No sales yet. Revenue, VAT, fees, refunds and profit appear here with the first Pro payment.</p><p class="muted"><a href="${PROJECTIONS_URL}">Profit projections (Notion)</a></p></section>`;
  const row = (label, value, note = '') => `<tr><td>${label}</td><td class="num">${value}</td><td class="muted">${note}</td></tr>`;
  return `<section class="card"><h2>Money · ${n(money.buyers)} Pro ${money.buyers === 1 ? 'sale' : 'sales'}</h2><table><tr><th></th><th class="num">USD</th><th></th></tr>
${row('Revenue, VAT included', usd(money.revenue), `of which top-ups ${usd(money.topups)}`)}${row('VAT', `−${usd(money.vat)}`)}${row('Stripe fees', `−${usd(money.fees)}`)}${row('AI cost', `−${usd(money.aiCost)}`)}
${row('Fixed costs', `−${usd(money.fixed)}`, esc(`estimate, from the projections page: ${fixedCosts.map(([name, value]) => `${name} $${value}/yr`).join(' · ')}`))}
<tr class="total"><td>Profit</td><td class="num">${money.profit < 0 ? '−' : ''}${usd(Math.abs(money.profit))}</td><td class="muted">${money.refunds ? `refunded ${usd(money.refunds)} (not in revenue)` : ''}</td></tr></table>
<p class="muted"><a href="${PROJECTIONS_URL}">Compare with the profit projections (Notion)</a></p></section>`;
}

export function page(data, {range = '30d', now = new Date()} = {}) {
  range = rangeOf(range);
  const filters = filterLinks(Object.entries(RANGES).map(([value, {name}]) => [value, name, `?range=${value}`]), range);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Monetization · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:30px;margin:4px 0}
.verdict.green{border-color:#3fb68b}.verdict.yellow{border-color:#f5b54a}.verdict.red{border-color:#e5484d}.filters{margin:8px 0 16px}h2{margin:0 0 8px}tr.total td{font-weight:700}${BARS_CSS}.funnel .night{grid-template-columns:190px minmax(0,1fr) 190px}@media (max-width:640px){.funnel .night{grid-template-columns:110px minmax(0,1fr)}}</style></head><body><main>
<header><h1>💰 Monetization</h1><span class="muted">Free vs Pro · ${esc(RANGES[range].name.toLowerCase())} · below ${TRIAL_MIN_FOR_VERDICT} completed trials the colour waits</span></header>
${filters}${tiles(data)}
<section class="card nights funnel"><h2>Funnel</h2><p class="muted" style="margin:0 0 8px">Right: the drop from the step before (– when a step is larger, e.g. installs that did not come through the website)</p>${funnelBars(data)}</section>
${costCard(data)}${moneyCard(data)}
</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const range = rangeOf(url.searchParams.get('range'));
  return new Response(page(await collect(env, range), {range}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}

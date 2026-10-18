// Headline numbers of the Growth and Intelligence pages (src/headlines.js; drawn by src/section-overview.js on /admin/growth-overview and /admin/intelligence-overview).
// The weekly series come from the same gatherer as the /admin Overview (src/overview.js report(): one way to count each number); Signups and Monetization read their own pages' collectors.
// Most of these numbers are activity, so their status is "none"; a count of a bad thing (problem reports) turns amber when it rose against last week.
import {report} from './overview.js';
import {collect as signups} from './signups.js';
import {collect as money} from './monetization-data.js';

const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const memo = new WeakMap();
// One gatherer run per request: the loaders of a section run together with the same database and `now`.
const cardsOf = (env, now) => { const hit = memo.get(env.STATS); if (hit?.now === now) return hit.cards;
  const cards = report(env.STATS, now).then(data => data.cards); memo.set(env.STATS, {now, cards}); return cards; };

// A card's series -> a tile: this week's value, the week before, and the bars.
function seriesTile(series, {label = series.label[0].toUpperCase() + series.label.slice(1), status} = {}) {
  const known = series.values.filter(v => v != null), format = series.format || (v => String(Math.round(v)));
  const last = series.values.at(-1), before = series.values.at(-2), better = series.higherIsBetter !== false;
  const worse = last != null && before != null && (better ? last < before : last > before);
  return {label, value: last == null ? (known.length ? '0' : 'No data') : format(last), sub: before == null ? 'this week' : `this week · last week ${format(before)}`,
    status: status || (!better && worse ? 'warn' : 'none'), series: series.values, format, higherIsBetter: better};
}
export const fromCards = key => async (env, now) => {
  if (!env.STATS) return [{label: key, value: '–', sub: 'no database', status: 'none'}];
  return ((await cardsOf(env, now))[key] || []).slice(0, 4).map(series => seriesTile(series));
};

async function signupsTiles(env, now) {
  if (!env.STATS) return [{label: 'Trial accounts', value: '–', sub: 'no database', status: 'none'}];
  const data = await signups(env, now);
  return [{label: 'Trial accounts', value: num(data.trial), sub: `${num(data.confirmed)} confirmed · ${num(data.unconfirmed)} not yet`, status: 'none'},
    {label: 'Converted to Pro', value: num(data.converted), sub: 'trial accounts that paid', status: 'none'}];
}

// Monetization: the page's own verdict colour (green/yellow/red/grey from src/monetization-data.js colourOf) on trial-to-Pro conversion, and the profit when sales exist.
async function monetizationTiles(env, now) {
  if (!env.STATS) return [{label: 'Trials that bought Pro', value: '–', sub: 'no database', status: 'none'}];
  const data = await money(env, '30d', now), {funnel, conversion} = data;
  const status = {green: 'good', yellow: 'warn', red: 'bad'}[conversion.colour] || 'none';
  return [{label: 'Trials that bought Pro', value: conversion.colour === 'grey' ? 'Too few' : `${Math.round(100 * conversion.ofTrials)}%`, sub: `${num(funnel.pro)} Pro of ${num(funnel.trials)} trials, 30 days · ${conversion.note}`, status, few: conversion.colour === 'grey'},
    data.money ? {label: 'Profit, 30 days', value: `$${data.money.profit.toFixed(0)}`, sub: `$${data.money.revenue.toFixed(0)} revenue · $${data.money.aiCost.toFixed(0)} AI`, status: data.money.profit >= 0 ? 'good' : 'bad'}
      : {label: 'Profit, 30 days', value: 'No data', sub: 'no sale yet', status: 'none'}];
}

export const GROWTH = {'/admin/website': fromCards('website'), '/admin/app': fromCards('app'), '/admin/signups': signupsTiles, '/admin/monetization': monetizationTiles, '/admin/feedback': fromCards('feedback')};
export const INTELLIGENCE = {'/admin/insights': fromCards('insights'), '/admin/brain': fromCards('brain')};

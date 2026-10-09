// What installs report so the product can learn what questions mean and where applications get stuck (Notion: "Knowledge as data:
// build plan"). Stored as counts. A question's wording is kept only while several installs report it; the rest is deleted by tidy().
//   POST /api/controls (src/recipes.js) hands {questions, flows} here.   GET /api/knowledge (owner): what the proposers work from.
import {installsNeeded} from './learning-floor.js';   // 1 for now: src/learning-floor.js
import {familyOf, familyOfInstall} from './engines.js';
import {ANSWER_COUNTS, ANSWER_ENGINES, MS_BUCKETS} from '../../desktop/lib/answer-counts.js';
import {cleanLabel} from '../../extension/alias-schema.js';
import {digestOf} from './guard.js';
import {isOwner} from './stats.js';
import {cleanUse} from '../../desktop/lib/proposal-use.js';

export {cleanLabel};
export const LEFT_REASONS = ['proposed', 'no_answer', 'not_taken', 'menu_not_clicked', 'menu_not_opened', 'menu_not_selected', 'menu_not_read', 'real_click', 'no_option', 'unread', 'by_you', 'by_you_unread', 'page_error', 'other'];   // desktop/lib/question-labels.js
import {RESULT_STATES} from '../../desktop/lib/application-result.js';
export const FLOW_STATES = ['filled', 'fill-error', 'account', 'no-form', 'no-form-after-apply', ...RESULT_STATES];   // the last ones: how an application ended (desktop/lib/application-result.js)
export const OUTCOMES = ['reply', 'screening', 'offer', 'rejected', 'no_response'], DAY_BUCKETS = ['', '0-3', '4-7', '8-14', '15-30', '31+'];
export const MS_COLUMNS = [...MS_BUCKETS.map(edge => `ms_${edge}`), 'ms_more'];   // form_answers' time buckets
export const KEEP_SINGLE_DAYS = 14, KEEP_FLOW_DAYS = 180;
const BOARD = /^(h:[0-9a-f]{10}|[a-z0-9.-]{2,40})$/;
const day = date => date.toISOString().slice(0, 10);

const merge = (json, value, max) => {
  let list = [];
  try { list = JSON.parse(json || '[]'); } catch { /* start again */ }
  return JSON.stringify(list.includes(value) ? list : [...list, value].slice(-max));
};

// -> {questions, flows} stored.
export async function store(env, body, install, now = new Date()) {
  let questions = 0, flows = 0, applications = 0, answers = 0;
  if (!env.STATS) return {questions, flows};
  const who = (await digestOf(String(install || 'anonymous'))).slice(0, 8);
  const family = await familyOfInstall(env.STATS, install);   // Claude or OpenAI, from the install's latest health report (src/engines.js)
  for (const item of (Array.isArray(body?.questions) ? body.questions : []).slice(0, 40)) {
    const label = cleanLabel(item?.label), board = String(item?.board || '');
    if (!label || !BOARD.test(board)) continue;
    const row = await env.STATS.prepare('SELECT installs, boards FROM question_labels WHERE label = ?').bind(label).first();
    const kind = String(item?.kind || '').replace(/[^a-z-]/g, '').slice(0, 20);
    if (row) {
      await env.STATS.prepare('UPDATE question_labels SET n = n + 1, installs = ?, boards = ?, last_day = ? WHERE label = ?')
        .bind(merge(row.installs, who, 5), merge(row.boards, board, 8), day(now), label).run();
    } else {
      await env.STATS.prepare('INSERT INTO question_labels (label, kind, n, installs, boards, first_day, last_day) VALUES (?, ?, 1, ?, ?, ?, ?)')
        .bind(label, kind, merge('[]', who, 5), merge('[]', board, 8), day(now), day(now)).run();
    }
    questions++;
  }
  // What people did with a proposed answer (desktop/lib/proposal-use.js): fixed words, counted per day, release and AI family.
  for (const item of (Array.isArray(body?.proposalUses) ? body.proposalUses : []).slice(0, 40)) {
    const use = cleanUse(item), n = Math.max(0, Math.min(500, Math.round(Number(item?.n)) || 0));
    if (!use || !n) continue;
    await env.STATS.prepare(`INSERT INTO proposal_use (day, board, source, act, version, ai_family, n) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (day, board, source, act, version, ai_family) DO UPDATE SET n = n + excluded.n`).bind(day(now), use.board, use.source, use.act, use.v, family, n).run();
  }
  for (const item of (Array.isArray(body?.flows) ? body.flows : []).slice(0, 20)) {
    const board = String(item?.board || ''), state = String(item?.state || '');
    const n = Math.max(0, Math.min(1000, Math.round(Number(item?.n)) || 0));
    if (!BOARD.test(board) || !FLOW_STATES.includes(state) || !n) continue;
    await env.STATS.prepare('INSERT INTO flow_outcomes (day, board, state, ai_family, n) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, board, state, ai_family) DO UPDATE SET n = n + excluded.n')
      .bind(day(now), board, state, family, n).run();
    flows++;
  }
  for (const item of (Array.isArray(body?.unfilled) ? body.unfilled : []).slice(0, 20)) {
    const board = String(item?.board || ''), reason = String(item?.reason || '');
    const n = Math.max(0, Math.min(1000, Math.round(Number(item?.n)) || 0));
    if (!BOARD.test(board) || !LEFT_REASONS.includes(reason) || !n) continue;
    await env.STATS.prepare('INSERT INTO fill_reasons (day, board, reason, ai_family, n) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, board, reason, ai_family) DO UPDATE SET n = n + excluded.n')
      .bind(day(now), board, reason, family, n).run();
  }
  // The AI's answers to form questions, per engine -> per family (migration 0046): the call's own engine is the truth; an install
  // that switched engine mid-day is still counted right.
  for (const item of (Array.isArray(body?.answers) ? body.answers : []).slice(0, ANSWER_ENGINES.length)) {
    if (!ANSWER_ENGINES.includes(item?.engine)) continue;
    const counts = ANSWER_COUNTS.map(key => Math.max(0, Math.min(100000, Math.round(Number(item[key])) || 0)));
    const ms = MS_BUCKETS.map((_, i) => i).concat(MS_BUCKETS.length).map(i => Math.max(0, Math.min(10000, Math.round(Number(item.ms?.[i])) || 0)));
    if (!counts[0]) continue;
    const aiFamily = familyOf(item.engine) === 'unknown' ? family : familyOf(item.engine);
    await env.STATS.prepare(`INSERT INTO form_answers (day, ai_family, ${ANSWER_COUNTS.join(', ')}, ${MS_COLUMNS.join(', ')}) VALUES (?, ?, ${[...counts, ...ms].map(() => '?').join(', ')})
      ON CONFLICT (day, ai_family) DO UPDATE SET ${[...ANSWER_COUNTS, ...MS_COLUMNS].map(key => `${key} = ${key} + excluded.${key}`).join(', ')}`)
      .bind(day(now), aiFamily, ...counts, ...ms).run();
    answers++;
  }
  for (const item of (Array.isArray(body?.applications) ? body.applications : []).slice(0, 20)) {
    const board = String(item?.board || ''), outcome = String(item?.outcome || ''), days = String(item?.days || '');
    const n = Math.max(0, Math.min(100, Math.round(Number(item?.n)) || 0));
    if (!BOARD.test(board) || !OUTCOMES.includes(outcome) || !DAY_BUCKETS.includes(days) || !n) continue;
    await env.STATS.prepare('INSERT INTO application_outcomes (day, board, outcome, days, n) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, board, outcome, days) DO UPDATE SET n = n + excluded.n')
      .bind(day(now), board, outcome, days, n).run();
    applications++;
  }
  return {questions, flows, applications, answers};
}

// Daily: a question only one or two installs ever reported is not kept; old flow counts roll off.
export async function tidy(db, now = new Date()) {
  const cutoff = day(new Date(now.getTime() - KEEP_SINGLE_DAYS * 86400000));
  const old = (await db.prepare('SELECT label, installs FROM question_labels WHERE last_day < ?').bind(cutoff).all()).results || [];
  let dropped = 0;
  for (const row of old) {
    let count = 0;
    try { count = JSON.parse(row.installs).length; } catch { /* unreadable: drop */ }
    if (count < installsNeeded('question')) { await db.prepare('DELETE FROM question_labels WHERE label = ?').bind(row.label).run(); dropped++; }
  }
  await db.prepare('DELETE FROM application_outcomes WHERE day < ?').bind(day(new Date(now.getTime() - 365 * 86400000))).run().catch(() => {});
  await db.prepare('DELETE FROM form_answers WHERE day < ?').bind(day(new Date(now.getTime() - KEEP_FLOW_DAYS * 86400000))).run().catch(() => {});
  await db.prepare('DELETE FROM fill_reasons WHERE day < ?').bind(day(new Date(now.getTime() - KEEP_FLOW_DAYS * 86400000))).run().catch(() => {});
  await db.prepare('DELETE FROM flow_outcomes WHERE day < ?').bind(day(new Date(now.getTime() - KEEP_FLOW_DAYS * 86400000))).run();
  return {dropped};
}

// Questions several installs report, most reported first; flows by board over the last days.
export async function report(db, days = 7, now = new Date(), limit = 100) {
  const rows = (await db.prepare('SELECT label, kind, n, installs, boards, last_day FROM question_labels ORDER BY n DESC LIMIT 400').all()).results || [];
  const questions = rows.map(row => ({label: row.label, kind: row.kind, n: row.n, installs: (() => { try { return JSON.parse(row.installs).length; } catch { return 0; } })(),
    boards: (() => { try { return JSON.parse(row.boards); } catch { return []; } })(), last: row.last_day})).filter(row => row.installs >= installsNeeded('question')).slice(0, limit);
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const flows = (await db.prepare('SELECT board, state, SUM(n) AS n FROM flow_outcomes WHERE day >= ? GROUP BY board, state ORDER BY board, n DESC').bind(from).all()).results || [];
  const outcomes = (await db.prepare('SELECT board, outcome, SUM(n) AS n FROM application_outcomes WHERE day >= ? GROUP BY board, outcome ORDER BY board, n DESC').bind(from).all().catch(() => ({results: []}))).results || [];
  return {questions, flows, outcomes};
}

// What applications typically get, per job board, for the apps to show back to their users ("Typical on Greenhouse: 38% hear back, usually within 4-7 days").
// Only a known board, only with 30+ marked outcomes in the last 180 days; "heard" = a reply, a call or an offer. The days are the middle bucket of the answers.
export const BENCH_MIN = 30;
const ORDER = ['0-3', '4-7', '8-14', '15-30', '31+'];
export async function benchmarks(db, now = new Date()) {
  const from = day(new Date(now.getTime() - 179 * 86400000));
  const rows = (await db.prepare('SELECT board, outcome, days, SUM(n) AS n FROM application_outcomes WHERE day >= ? GROUP BY board, outcome, days').bind(from).all().catch(() => ({results: []}))).results || [];
  const boards = new Map();
  for (const row of rows) {
    if (!/^[a-z]{3,20}$/.test(row.board)) continue;   // a hashed site means nothing to a person
    const entry = boards.get(row.board) || {board: row.board, n: 0, heard: 0, days: {}};
    entry.n += row.n;
    if (['reply', 'screening', 'offer'].includes(row.outcome)) { entry.heard += row.n; if (ORDER.includes(row.days)) entry.days[row.days] = (entry.days[row.days] || 0) + row.n; }
    boards.set(row.board, entry);
  }
  return [...boards.values()].filter(entry => entry.n >= BENCH_MIN).sort((a, b) => b.n - a.n).slice(0, 12).map(entry => {
    let seen = 0, middle = '';
    for (const bucket of ORDER) { seen += entry.days[bucket] || 0; if (!middle && seen * 2 >= entry.heard && entry.heard) middle = bucket; }
    return {board: entry.board, n: entry.n, heard: Math.round(entry.heard / entry.n * 100) / 100, days: middle};
  });
}

// GET /api/knowledge (owner).
export async function knowledge(request, env, now = new Date()) {
  if (!await isOwner(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
  return Response.json({generated: now.toISOString(), ...(await report(env.STATS, 30, now))}, {headers: {'Cache-Control': 'private, no-store'}});
}

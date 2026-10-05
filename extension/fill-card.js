// One anonymous record per fill (a "fill card"), for learning how well the form filling does and why: counts and fixed words only,
// never an answer, a question's wording, a field id or an address. The app adds the board and sends it with the shared counts
// (desktop/lib/recipes.js); the site keeps one row per fill (site/src/recipes.js, fill_cards) and builds the weekly learning digest
// from them (site/src/digest.js). The panel adds, at Submit, what you answered yourself (extension/review.js, by the card's id).

// Why a required field stayed empty, as one fixed word: the finer split of "no answer" says whose gap it is.
//   no_data       nothing could answer it: the kit and your details have nothing, and it was not for Claude (contact, file, kit-covered)
//   ai_declined   Claude was asked and gave no answer
//   ai_unsure     Claude answered with low confidence and the answer was not used
//   ai_off        Claude was not asked: answering with Claude was off, or you were not eligible
//   ai_error      Claude was asked and the call failed
//   not_taken / real_click / no_option   the field did not take the answer / a dropdown needing a real click / no option matched
//   unread        a required question on the page the reader did not read
//   other         anything else (its first words go nowhere: only this word is counted)
export const CAUSES = ['no_data', 'ai_declined', 'ai_unsure', 'ai_off', 'ai_error', 'not_taken', 'real_click', 'no_option', 'unread', 'other'];
const NO_ANSWER = 'no answer in the kit, Profile or your details';

export function causeOf(row, {sent = new Set(), ai = null, aiError = '', useAI = true} = {}) {
  const reason = String(row?.reason || '');
  if (/^question (on the page not read|text not found)/.test(reason)) return 'unread';
  if (reason.startsWith('answer given')) return 'not_taken';
  if (reason.startsWith('dropdown that opens')) return 'real_click';
  if (reason.startsWith('dropdown clicked')) return 'no_option';
  if (reason !== NO_ANSWER) return 'other';
  if (!sent.has(row.field)) return useAI ? 'no_data' : 'ai_off';
  if (aiError) return 'ai_error';
  if (!ai) return 'ai_off';
  const given = (ai.answers || []).find(answer => answer.field === row.field);
  if (!given) return 'ai_declined';
  return given.confidence && given.confidence !== 'high' ? 'ai_unsure' : 'ai_declined';
}

const count = (list, key) => list.reduce((out, item) => { const k = key(item); if (k) out[k] = (out[k] || 0) + 1; return out; }, {});

// trace: the fill's rows ({label, field?, type, required, outcome, reason}); form: what was read ({field, label}); sent: the fields
// asked of Claude. -> the card.
export function fillCard({id, trace = [], form = [], sent = [], ai = null, aiError = '', useAI = true, kit = false, version = '', startedAt, endedAt = new Date()}) {
  const fieldOf = new Map(form.map(row => [String(row.label || '').trim(), row.field]));
  const rows = trace.filter(row => row && row.type !== 'file' && !/^legal/.test(String(row.reason || '')))
    .map(row => ({...row, field: row.field || fieldOf.get(String(row.label || '').trim())}));
  const required = rows.filter(row => row.required);
  const left = required.filter(row => row.outcome !== 'filled');
  const context = {sent: new Set(sent), ai, aiError, useAI};
  const causes = count(left, row => causeOf(row, context));
  return {
    id: String(id || ''), v: String(version || '').slice(0, 20),
    required: required.length, filled: required.length - left.length, left: left.length, unread: causes.unread || 0,
    optional: rows.length - required.length, optionalFilled: rows.filter(row => !row.required && row.outcome === 'filled').length,
    causes, kinds: count(left, row => String(row.type || 'other').replace(/[^a-z-]/g, '').slice(0, 20) || 'other'),
    ai: aiError ? 'error' : ai ? 'used' : useAI ? 'none' : 'off', kit: !!kit,
    seconds: startedAt ? Math.max(0, Math.round((endedAt - new Date(startedAt)) / 1000)) : 0,
  };
}

// The same card as the site stores it: only these fields, each checked (desktop/lib/recipes.js and site/src/recipes.js use it too).
export function cleanCard(card) {
  const n = (value, max = 500) => Math.max(0, Math.min(max, Math.round(Number(value)) || 0));
  const counts = (object, allowed) => Object.fromEntries(Object.entries(object && typeof object === 'object' ? object : {})
    .filter(([key, value]) => (allowed ? allowed.includes(key) : /^[a-z-]{1,20}$/.test(key)) && n(value) > 0).slice(0, 12).map(([key, value]) => [key, n(value)]));
  if (!/^[\w-]{8,40}$/.test(String(card?.id || ''))) return null;
  return {id: card.id, v: /^[\w.+-]{1,20}$/.test(String(card.v || '')) ? card.v : '', required: n(card.required), filled: n(card.filled), left: n(card.left),
    unread: n(card.unread), optional: n(card.optional), optionalFilled: n(card.optionalFilled), causes: counts(card.causes, CAUSES), kinds: counts(card.kinds),
    ai: ['used', 'none', 'off', 'error'].includes(card.ai) ? card.ai : 'none', kit: !!card.kit, seconds: n(card.seconds, 3600)};
}

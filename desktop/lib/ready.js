// Ready to send (private spec job-pilotto-internal:docs/specs/2026-10-17-ready-to-send.md): which jobs the night prepares (kit + tailored CV + cover letter) and whether one is prepared.
// Pure, no Electron: the task (kit-handlers.js) and the queue views read it. "Prepared" is honest: the answers are predicted from the posting and the
// profile; a form's own questions are only known when the fill reads it, so nothing here says "verified". Guarded by desktop/test/ready.test.js.
import {kitOf} from './store/kit-section.js';

export const DEFAULT_MIN_FIT = 60;   // owner, 17 Oct 2026
export const DEFAULT_PER_NIGHT = 10;
export const MAX_PER_NIGHT = 15;

const open = job => ['unreviewed', 'saved'].includes(job.status) && !!job.url && !!job.code;
const PERSONAL = /^(first_name|last_name|preferred_name|email|phone|resume|resume_text|cover_letter|cover_letter_text|longitude|latitude)$/;

// The settings as numbers in range (a typed box can hold anything).
export function settingsOf(raw = {}) {
  const fit = Number(raw.minFit), count = Number(raw.perNight);
  return {on: raw.on === true, told: String(raw.told || ''),   // told: the night whose morning line was already sent
    minFit: Number.isFinite(fit) ? Math.max(0, Math.min(100, Math.round(fit))) : DEFAULT_MIN_FIT,
    perNight: Number.isFinite(count) && count >= 1 ? Math.min(MAX_PER_NIGHT, Math.round(count)) : DEFAULT_PER_NIGHT};
}

// Answers a person must still give: an empty answer or one the kit flagged, except what comes from Your details or a file.
export function openAnswers(kit) {
  return (kit?.answers || []).filter(item => !PERSONAL.test(item.field || '') && (!String(item.answer || '').trim() || item.needs_review));
}

// done: the job has a kit, a tailored CV and a letter PDF (rows carry kit / tailored / letter). Best first: saved, then by fit.
export const complete = job => !!job.kit && !!job.tailored && !!job.letter && !job.ineligible;
const best = (a, b) => (b.status === 'saved') - (a.status === 'saved') || (b.fit ?? -1) - (a.fit ?? -1);

// What a night works through: open, good enough fit, something still missing.
export function pickToPrepare(jobs, {minFit = DEFAULT_MIN_FIT, perNight = DEFAULT_PER_NIGHT} = {}) {
  return jobs.filter(job => open(job) && (job.fit ?? -1) >= minFit && !job.ineligible && !complete(job)).sort(best).slice(0, perNight);
}

// prepared | waiting (with why) | todo. `kit`: the job's kit JSON when it was read (kitOf of its section), else null.
export function preparedState(job, kit = null) {
  if (!open(job)) return {state: 'none', reasons: []};
  if (job.ineligible) return {state: 'waiting', reasons: [`not eligible: ${job.ineligible}`]};
  if (!complete(job)) return {state: 'todo', reasons: []};
  const questions = openAnswers(kit);
  if (questions.length) return {state: 'waiting', reasons: [`${questions.length} answer${questions.length === 1 ? '' : 's'} need you`], open: questions.length};
  return {state: 'prepared', reasons: []};
}

export {kitOf};

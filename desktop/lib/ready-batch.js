// Ready to send, tonight's batch (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): which finished jobs go to the night, and the batch the site takes (the contact, your facts for the AI, and per job: the kit,
// the tailored CV and the cover letter PDF as the extension would upload them). Everything it reads comes in as a function, so a test needs no store, no Electron and no Notion. Guard: test/ready-batch.test.js.
import {DEFAULT_MIN_FIT, DEFAULT_PER_NIGHT, complete} from './ready.js';
import {chosen} from './ai/index.js';

const open = job => ['unreviewed', 'saved'].includes(job.status) && !!job.url && !!job.code;
const best = (a, b) => (b.status === 'saved') - (a.status === 'saved') || (b.fit ?? -1) - (a.fit ?? -1);

// The jobs whose kit, tailored CV and letter are all done, best first: saved, then by fit.
export const pickToSend = (jobs, {minFit = DEFAULT_MIN_FIT, perNight = DEFAULT_PER_NIGHT} = {}) =>
  jobs.filter(job => open(job) && (job.fit ?? -1) >= minFit && !job.ineligible && complete(job)).sort(best).slice(0, perNight);

// Jobs you opened in your browser but did not submit (Applying: Open in my browser marks them), with their kit, CV and letter: Fill now fills them again only after
// your yes (owner, 18 Oct 2026: "that should be possible, but with a confirmation popup"); the automatic night never takes them.
export const pickToRefill = (jobs, {perNight = DEFAULT_PER_NIGHT} = {}) =>
  jobs.filter(job => job.status === 'applying' && !!job.url && !!job.code && !job.ineligible && complete(job)).sort(best).slice(0, perNight);

const pad = n => String(n).padStart(2, '0');
const day = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// The morning a batch is for: tonight's batch is for tomorrow, one made after midnight is for today. fillAt: 02:00 that morning, this Mac's time (ISO).
export function nightOf(now = new Date()) {
  const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() >= 12 ? 1 : 0));
  return {night: day(morning), fillAt: new Date(morning.getFullYear(), morning.getMonth(), morning.getDate(), 2, 0).toISOString()};
}

// deps: {store: {findJob(url), kit(id)}, me(url) -> the extension's "your details" ({contact, resume, coverLetterFile}), facts() -> {profile, standard, search, cvFacts, knowledge}}.
// -> {batch, skipped: [{code, why}]}. A job with no tailored CV file or no kit is left out and said so, never sent half-made.
export async function buildBatch(jobs, deps, {now = new Date(), readyBy = '07:30'} = {}) {
  const sent = [], skipped = [];
  let contact = {};
  for (const job of jobs) {
    const found = await deps.store.findJob(job.url).catch(() => null);
    const kit = found ? await deps.store.kit(found.id).catch(() => null) : null;
    const mine = await deps.me(job.url).catch(() => null);
    if (!kit) { skipped.push({code: job.code, why: 'no kit found'}); continue; }
    if (!mine?.resume?.data) { skipped.push({code: job.code, why: 'no CV file'}); continue; }
    if (!Object.keys(contact).length) contact = mine.contact || {};
    sent.push({id: job.code, url: job.url, title: job.title || '', company: job.company || '', fit: job.fit ?? null, kit: {answers: kit.answers || []}, letter: kit.cover_letter || '',
      cv: mine.resume.data, letterPdf: mine.coverLetterFile?.data || ''});
  }
  const {night, fillAt} = nightOf(now);
  return {batch: {night, fillAt, readyBy, contact, facts: sent.length ? await deps.facts() : {}, jobs: sent}, skipped};
}

// The night's AI is the user's own: his Claude key goes sealed with the batch (the site deletes it with the batch); without one the site answers with his Free AI.
// The key the night may use: only when the API key IS the engine the app runs on. A key left stored from before (an engine now on Claude Code,
// OpenAI or Codex) stays home: 18 Oct 2026, the first night carried such an old key, Anthropic refused every call and no question was answered.
export const ownKeyFor = (settings, keys) => (chosen(settings, keys) === 'api' ? String(keys.ANTHROPIC_API_KEY || '') : '');
export const withOwnAi = (batch, secret) => (/^sk-ant-/.test(String(secret || '')) ? {...batch, ai: {key: String(secret)}} : batch);

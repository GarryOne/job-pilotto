// A replaced CV and what follows it.
import {el, pill} from '../components.js';
import {shared} from './shared.js';
import {$, message, show} from './core.js';
import {loadCvSetting} from './profile.js';

// ---------- a replaced CV: what follows it (suggested Profile edits, tailoring base, unsent kits), never a rebuild ----------
let cvSuggestions = [];
export async function showCvChanged() {
  const change = await window.pilot.cvChange();
  $('cv-changed-text').textContent = `Your CV changed${change.at ? ` on ${new Date(change.at).toLocaleDateString()}` : ''}: review what it changes.`;
  show($('cv-changed'), !!change.at);
  show($('strategy-cv-changed'), !!change.at);
}
export async function openCvChange() {
  const change = await window.pilot.cvChange();
  // What applying Profile edits costs: every scored job is re-scored over the next searches.
  $('cv-impact').textContent = '';
  window.pilot.strategyData().then(data => {
    if (!data?.ok || !data.scored) return;
    const searches = Math.max(1, Math.ceil(data.scored / 60));
    $('cv-impact').textContent = `Applying Profile edits re-scores ${data.scored} jobs over the next ${searches} search${searches === 1 ? '' : 'es'} ` +
      `(≈ $${(data.scored * 0.015).toFixed(2)})${data.counts?.kits ? `; ${data.counts.kits} unsent kits were drafted with the old Profile` : ''}.`;
  }).catch(() => {});
  $('cv-dialog-name').textContent = `${change.previous ? `${change.previous} → ` : ''}${change.name || 'your CV'}`;
  $('cv-suggestions').replaceChildren();
  show($('cv-apply-row'), false);
  message('cv-review-message', '');
  $('cv-compare').disabled = !change.comparable;
  if (!change.comparable) $('cv-profile-text').textContent = 'The previous CV is not on this computer, so there is nothing to compare. Edit the Profile in Notion if needed.';
  $('cv-base-text').textContent = change.base ? 'made from the previous CV. Read the new one so tailored CVs start from it.' : 'read from this CV on your first ✂️ Tailor CV. Nothing to do.';
  show($('cv-base-actions'), change.base);
  const kits = shared.allJobs.filter(job => job.kit && job.code && job.status !== 'applied' && job.status !== 'dismissed');
  $('cv-kits').replaceChildren(...kits.map(job => {
    const row = el('div', 'cv-kit');
    const redraft = el('button', 'ghost', '↻ Redraft');
    redraft.addEventListener('click', async () => {
      redraft.disabled = true;
      redraft.textContent = 'Redrafting…';
      const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
      redraft.textContent = result.ok ? '✓ Redrafted' : 'Retry';
      redraft.disabled = !!result.ok;
    });
    row.append(el('span', '', `${job.title} · ${job.company}`), redraft);
    return row;
  }));
  show($('cv-kits-row'), kits.length > 0);
  if (!$('cv-dialog').open) $('cv-dialog').showModal();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('cv-changed-open').addEventListener('click', openCvChange);
  $('cv-compare').addEventListener('click', async () => {
    const button = $('cv-compare');
    button.disabled = true;
    button.classList.add('busy');
    message('cv-review-message', 'Claude is comparing your CVs with your Profile… (about 30 s)', 'waiting');
    const result = await window.pilot.cvReview();
    button.disabled = false;
    button.classList.remove('busy');
    if (!result.ok) return message('cv-review-message', result.error, 'error');
    cvSuggestions = result.suggestions;
    message('cv-review-message', `${result.summary} ($${result.usd.toFixed(2)})${cvSuggestions.length ? '' : ' Nothing in your Profile needs to change.'}`, 'ok');
    const label = {update: ['Update', 'info'], add: ['Add', 'good'], remove: ['Remove', 'bad']};
    $('cv-suggestions').replaceChildren(...cvSuggestions.map(s => {
      const row = el('label', 'radio cv-suggestion');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = s.kind !== 'remove';  // removals are opt-in
      box.dataset.id = s.id;
      const body = el('span');
      body.append(pill(label[s.kind][0], label[s.kind][1]), ' ');
      if (s.kind !== 'add') body.append(el('s', 'muted', s.block.text), s.kind === 'update' ? ' → ' : '');
      if (s.kind !== 'remove') body.append(el('b', '', s.text));
      if (s.kind === 'add') body.append(el('span', 'muted', ` (after “${s.block.text.slice(0, 60)}”)`));
      body.append(el('div', 'muted small', s.why));
      row.append(box, body);
      return row;
    }));
    show($('cv-apply-row'), cvSuggestions.length > 0);
  });
  $('cv-apply').addEventListener('click', async () => {
    const picked = new Set([...$('cv-suggestions').querySelectorAll('input:checked')].map(box => Number(box.dataset.id)));
    const accepted = cvSuggestions.filter(s => picked.has(s.id));
    if (!accepted.length) return message('cv-review-message', 'Nothing selected.', 'waiting');
    $('cv-apply').disabled = true;
    const result = await window.pilot.cvApply(accepted);
    $('cv-apply').disabled = false;
    if (!result.ok) return message('cv-review-message', result.error, 'error');
    message('cv-review-message', result.failed.length ? `${result.applied} applied; not applied: ${result.failed.join('; ')}`
      : `✓ ${result.applied} change${result.applied === 1 ? '' : 's'} saved to your Profile in Notion.`, result.failed.length ? 'error' : 'ok');
    if (!result.failed.length) { $('cv-suggestions').replaceChildren(); show($('cv-apply-row'), false); }
  });
  $('cv-base-read').addEventListener('click', async () => {
    const button = $('cv-base-read');
    button.disabled = true;
    button.textContent = 'Reading your CV… (about 30 s)';
    const result = await window.pilot.importCv();
    button.textContent = result.ok ? `✓ Done ($${result.usd.toFixed(2)})` : 'Retry';
    button.disabled = !!result.ok;
    loadCvSetting();
  });
  $('cv-later').addEventListener('click', () => { $('cv-dialog').close(); showCvChanged(); });
  $('cv-done').addEventListener('click', async () => { await window.pilot.cvChangeDone(); $('cv-dialog').close(); showCvChanged(); });
}

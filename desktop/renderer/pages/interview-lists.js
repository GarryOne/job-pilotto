// Interviews page, the job list helpers (names, the picker's options, the pasted link), the unsaved-recordings list and
// the speaker-name fields. Moved out of interviews.js, which passes in the open draft and what to do with it.
// Guarded by test/interviews.test.js, test/interview-library.test.js and test/review-again.test.js.
import {el, moreButton, pill, tile} from '../components.js';
import {shared} from './shared.js';
import {$, osText, show} from './core.js';
import {byStore} from '../store-words.js';

const iv = window.pilot.interviews;
export const plainId = id => String(id || '').replace(/-/g, '');
export const jobList = () => (Array.isArray(shared.allJobs) ? shared.allJobs : []);  // unset while the job list loads
export const jobName = job => `${job.company} — ${job.title}${job.status === 'applied' ? ' (applied)' : ''}`;
// An interview's job: by its Notion page, or by the store's id on a store without pages (job.page_id, src/desktop_store_jobs.py).
export const jobForPage = pageId => jobList().find(job => (job.page_id && plainId(job.page_id) === plainId(pageId))
  || (job.notion_url && plainId(job.notion_url).includes(plainId(pageId))));

// Every job in the list (applied and tracked ones first); one not in Applications yet is added there on save.
export const PASTE = '__paste__';
export function jobOptions(select, chosenUrl, emptyLabel) {
  const rank = job => (job.status === 'applied' ? 0 : job.notion_url || job.page_id ? 1 : 2);   // tracked first, on any store
  const jobs = jobList().filter(job => job.url && job.status !== 'dismissed')
    .sort((a, b) => rank(a) - rank(b) || a.company.localeCompare(b.company));
  select.replaceChildren(new Option(emptyLabel, ''), ...jobs.map(job => new Option(jobName(job), job.url, false, job.url === chosenUrl)));
  if (chosenUrl && !jobs.some(job => job.url === chosenUrl)) select.append(new Option(chosenUrl, chosenUrl, false, true));
  select.append(new Option('Paste a job link…', PASTE));
}
export const jobUrlOf = (select, input) => (select.value === PASTE ? (/^https?:\/\//.test(input.value.trim()) ? input.value.trim() : '') : select.value);


export function renderDrafts(drafts, env) {
  show($('iv-drafts-block'), drafts.length > 0);
  $('iv-unsaved').textContent = `${drafts.length} unsaved`;
  // Status: words for the meta line, and a pill.
  const STATUS = {new: 'Not transcribed', recording: 'Recording…', transcribing: 'Transcribing…', stopped: 'Stopped: transcribe again',
    failed: 'Failed', ready: 'Transcript ready'};
  const PILL = {ready: ['good', 'Ready'], transcribing: ['signal', 'Transcribing'], recording: ['signal', 'Recording'], failed: ['bad', 'Failed']};
  $('iv-drafts').replaceChildren(...drafts.map(draft => {
    const busy = draft.status === 'recording' || draft.status === 'transcribing';
    const row = el('div', `iv-draft${draft.id === env.openId() ? ' open' : ''}`);
    const text = el('div', 'iv-draft-text');
    const when = new Date(draft.createdAt).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    const meta = el('div', 'muted small');
    const parts = [when, draft.seconds ? `${Math.max(1, Math.round(draft.seconds / 60))} min` : '', STATUS[draft.status] || draft.status,
      draft.pageUrl ? 'Transcript in Notion' : 'Stored on this Mac'].filter(Boolean);   // about Notion
    meta.textContent = parts.join('  ·  ');
    text.append(el('b', '', draft.title), meta);
    const [tone, label] = PILL[draft.status] || ['neutral', STATUS[draft.status] || draft.status];
    const state = pill(label, tone, {dot: true});
    // The next step for this draft: transcribe it, or review the transcript and save it.
    const needsTranscript = draft.kind === 'audio' && ['new', 'stopped', 'failed'].includes(draft.status);
    const main = Object.assign(el('button', 'primary iv-main', draft.status === 'ready' ? 'Review & save' : needsTranscript ? 'Transcribe' : 'Open'),
      {disabled: busy && draft.id !== env.openId()});
    main.addEventListener('click', () => env.openDraft(draft.id));
    const menu = [{label: 'Open', run: () => env.openDraft(draft.id)}];
    if (draft.pageUrl) menu.push({label: '↗ Transcript in Notion', run: () => window.pilot.openExternal(draft.pageUrl)});
    // Saved with the data on this Mac (no page to open): the saved transcript and its review in the app (interview-review-view.js).
    else if (draft.pageId && env.openReview) menu.push({label: 'Transcript and review', run: () => env.openReview(draft.pageId)});
    menu.push({label: osText('Show in Finder'), run: () => iv.recordings(), title: 'The recordings kept on this Mac'});
    if (!busy) {
      menu.push('-', {label: draft.pageId ? byStore('Delete here and in Notion', 'Delete') : 'Delete recording', danger: true, run: async () => {
        if (!confirm(draft.pageId ? `Delete "${draft.title}"${byStore(' on this Mac and in Notion', '')}?` : `Delete "${draft.title}" and its recording?`)) return;
        await iv.discard(draft.id);
        if (env.openId() === draft.id) env.closeEditor();
        renderDrafts(await iv.drafts(), env);
      }});
    }
    const actions = el('div', 'row-actions');
    actions.append(main, moreButton(menu, 'More: open, show in Finder, delete'));
    row.append(tile(draft.kind === 'audio' ? 'mic' : 'file'), text, state, actions);
    return row;
  }));
}

// One field per speaker; renaming rewrites every "[time] Name:" line of the transcript.
export function renderSpeakers(onRename) {
  const names = [...new Set([...$('iv-text').value.matchAll(/^\[\d\d:\d\d:\d\d\] ([^:\n]{1,60}):/gm)].map(m => m[1]))];
  $('iv-speakers').replaceChildren(...names.map(name => {
    const label = Object.assign(document.createElement('label'), {textContent: name});
    const input = Object.assign(document.createElement('input'), {value: name, placeholder: 'e.g. You, Recruiter, Hiring manager'});
    input.addEventListener('change', () => {
      const to = input.value.replace(/[:\n[\]]/g, ' ').trim();
      if (!to || to === name) { input.value = name; return; }
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      $('iv-text').value = $('iv-text').value.replace(new RegExp(`^(\\[\\d\\d:\\d\\d:\\d\\d\\] )${escaped}:`, 'gm'), `$1${to}:`);
      onRename();
      renderSpeakers(onRename);
    });
    label.append(input);
    return label;
  }));
}

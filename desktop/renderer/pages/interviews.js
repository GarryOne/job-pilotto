// Interviews page.
import {closeMenu, el, moreButton, pill, tile} from '../components.js';
import {avatar, placeAndMode} from '../jobs-view.js';
import {shared} from './shared.js';
import {$, message, osText, show} from './core.js';

// ---------- interviews: drafts on this Mac, saved ones in Notion 🎤 Interviews ----------
const iv = window.pilot.interviews;
let ivOpen = null;          // the draft in the editor
let ivSavedRows = [];
const plainId = id => String(id || '').replace(/-/g, '');
const linkable = () => shared.allJobs.filter(job => job.notion_url);   // jobs with a Notion Applications row
const jobName = job => `${job.company} — ${job.title}${job.status === 'applied' ? ' (applied)' : ''}`;
const jobForPage = pageId => shared.allJobs.find(job => job.notion_url && plainId(job.notion_url).includes(plainId(pageId)));

// Every job in the list (applied and tracked ones first); one not in Applications yet is added there on save.
const PASTE = '__paste__';
function jobOptions(select, chosenUrl, emptyLabel) {
  const rank = job => (job.status === 'applied' ? 0 : job.notion_url ? 1 : 2);
  const jobs = shared.allJobs.filter(job => job.url && job.status !== 'dismissed')
    .sort((a, b) => rank(a) - rank(b) || a.company.localeCompare(b.company));
  select.replaceChildren(new Option(emptyLabel, ''), ...jobs.map(job => new Option(jobName(job), job.url, false, job.url === chosenUrl)));
  if (chosenUrl && !jobs.some(job => job.url === chosenUrl)) select.append(new Option(chosenUrl, chosenUrl, false, true));
  select.append(new Option('Paste a job link…', PASTE));
}
const jobUrlOf = (select, input) => (select.value === PASTE ? (/^https?:\/\//.test(input.value.trim()) ? input.value.trim() : '') : select.value);

// Which macOS permission is missing, with a button to its System Settings page and one to restart
// (macOS applies Screen & System Audio Recording only after the app restarts).
let permissionKind = 'screen';
async function showPermission(noCallAudio = false) {
  const access = await iv.access();
  // npm start: macOS may list the terminal that started the app instead of Electron.
  const who = access.dev ? 'your terminal app (e.g. <b>iTerm</b>; quit and reopen it)' : '<b>Job Pilotto</b> (+ to add it)';
  let text = '';
  if (access.microphone === 'denied' || access.microphone === 'restricted') {
    permissionKind = 'microphone';
    text = `🎙️ <b>Allow the microphone</b>: Privacy &amp; Security → Microphone → ${who}, then restart.`;
  } else if (await iv.tapAvailable()) {
    // AudioTee: only "System Audio Recording Only" is needed; shown when a recording hears no call audio.
    if (noCallAudio) {
      permissionKind = 'screen';
      text = `🔊 <b>No call audio yet</b>: Privacy &amp; Security → Screen &amp; System Audio Recording → <b>System Audio Recording Only</b> → ${who}, then restart.`;
    }
  } else if (access.screen !== 'granted' || noCallAudio) {
    permissionKind = 'screen';
    text = `🔊 <b>Allow the call's audio</b>: Privacy &amp; Security → Screen &amp; System Audio Recording → <b>top list</b> (not "System Audio Recording Only") → ${who}, then restart.`;
  }
  $('iv-permission-text').innerHTML = text;
  show($('iv-permission'), !!text);
}

export async function loadInterviews() {
  showPermission();
  if (!shared.allJobs.length) { try { shared.allJobs = (await window.pilot.jobs()).jobs; } catch {} }
  renderDrafts(await iv.drafts());
  loadSaved();
}

function renderDrafts(drafts) {
  show($('iv-drafts-block'), drafts.length > 0);
  $('iv-unsaved').textContent = `${drafts.length} unsaved`;
  // Status: words for the meta line, and a pill.
  const STATUS = {new: 'Not transcribed', recording: 'Recording…', transcribing: 'Transcribing…', stopped: 'Stopped: transcribe again',
    failed: 'Failed', ready: 'Transcript ready'};
  const PILL = {ready: ['good', 'Ready'], transcribing: ['signal', 'Transcribing'], recording: ['signal', 'Recording'], failed: ['bad', 'Failed']};
  $('iv-drafts').replaceChildren(...drafts.map(draft => {
    const busy = draft.status === 'recording' || draft.status === 'transcribing';
    const row = el('div', `iv-draft${draft.id === ivOpen ? ' open' : ''}`);
    const text = el('div', 'iv-draft-text');
    const when = new Date(draft.createdAt).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    const meta = el('div', 'muted small');
    const parts = [when, draft.seconds ? `${Math.max(1, Math.round(draft.seconds / 60))} min` : '', STATUS[draft.status] || draft.status,
      draft.pageUrl ? 'Transcript in Notion' : 'Stored on this Mac'].filter(Boolean);
    meta.textContent = parts.join('  ·  ');
    text.append(el('b', '', draft.title), meta);
    const [tone, label] = PILL[draft.status] || ['neutral', STATUS[draft.status] || draft.status];
    const state = pill(label, tone, {dot: true});
    // The next step for this draft: transcribe it, or review the transcript and save it.
    const needsTranscript = draft.kind === 'audio' && ['new', 'stopped', 'failed'].includes(draft.status);
    const main = Object.assign(el('button', 'primary iv-main', draft.status === 'ready' ? 'Review & save' : needsTranscript ? 'Transcribe' : 'Open'),
      {disabled: busy && draft.id !== ivOpen});
    main.addEventListener('click', () => openDraft(draft.id));
    const menu = [{label: 'Open', run: () => openDraft(draft.id)}];
    if (draft.pageUrl) menu.push({label: '↗ Transcript in Notion', run: () => window.pilot.openExternal(draft.pageUrl)});
    menu.push({label: osText('Show in Finder'), run: () => iv.recordings(), title: 'The recordings kept on this Mac'});
    if (!busy) {
      menu.push('-', {label: draft.pageId ? 'Delete here and in Notion' : 'Delete recording', danger: true, run: async () => {
        if (!confirm(draft.pageId ? `Delete "${draft.title}" on this Mac and in Notion?` : `Delete "${draft.title}" and its recording?`)) return;
        await iv.discard(draft.id);
        if (ivOpen === draft.id) { ivOpen = null; show($('iv-editor'), false); }
        renderDrafts(await iv.drafts());
      }});
    }
    const actions = el('div', 'row-actions');
    actions.append(main, moreButton(menu, 'More: open, show in Finder, delete'));
    row.append(tile(draft.kind === 'audio' ? 'mic' : 'file'), text, state, actions);
    return row;
  }));
}

async function openDraft(id) {
  const draft = (await iv.drafts()).find(d => d.id === id);
  if (!draft) return;
  ivOpen = id;
  show($('iv-editor'));
  $('iv-title').value = draft.title || '';
  const busy = draft.status === 'transcribing';
  show($('iv-transcribe'), draft.kind === 'audio' && ['new', 'stopped', 'failed'].includes(draft.status));
  show($('iv-progress'), busy);
  show($('iv-ready'), draft.status === 'ready');
  if (draft.status === 'failed') message('iv-message', draft.error || 'Transcription failed', 'error');
  if (draft.status === 'ready') {
    $('iv-text').value = await iv.transcript(id);
    jobOptions($('iv-job'), draft.jobUrl || draft.suggestedJobUrl, 'Let Claude find the job when reviewing');
    // A job matched by time to a calendar interview: shown as a suggestion; saving confirms it, changing the job replaces it.
    const suggested = !draft.jobUrl && draft.suggestedJobUrl;
    show($('iv-suggest'), !!suggested);
    if (suggested) $('iv-suggest').textContent = `Suggested from your calendar: ${draft.suggestedJob}. Change it below if this was a different interview.`;
    show($('iv-job-url'), false);
    $('iv-job-url').value = '';
    renderSpeakers();
  }
  renderDrafts(await iv.drafts());
  $('iv-editor').scrollIntoView({behavior: 'smooth', block: 'start'});
}

// One field per speaker; renaming rewrites every "[time] Name:" line of the transcript.
function renderSpeakers() {
  const names = [...new Set([...$('iv-text').value.matchAll(/^\[\d\d:\d\d:\d\d\] ([^:\n]{1,60}):/gm)].map(m => m[1]))];
  $('iv-speakers').replaceChildren(...names.map(name => {
    const label = Object.assign(document.createElement('label'), {textContent: name});
    const input = Object.assign(document.createElement('input'), {value: name, placeholder: 'e.g. You, Recruiter, Hiring manager'});
    input.addEventListener('change', () => {
      const to = input.value.replace(/[:\n[\]]/g, ' ').trim();
      if (!to || to === name) { input.value = name; return; }
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      $('iv-text').value = $('iv-text').value.replace(new RegExp(`^(\\[\\d\\d:\\d\\d:\\d\\d\\] )${escaped}:`, 'gm'), `$1${to}:`);
      saveOpenDraft();
      renderSpeakers();
    });
    label.append(input);
    return label;
  }));
}

let draftTimer;
function saveOpenDraft() {
  if (!ivOpen) return Promise.resolve();
  clearTimeout(draftTimer);
  return iv.saveDraft(ivOpen, {title: $('iv-title').value, jobUrl: jobUrlOf($('iv-job'), $('iv-job-url')),
    ...($('iv-ready').hidden ? {} : {text: $('iv-text').value})});
}

async function saveToNotion(andReview) {
  await saveOpenDraft();
  const id = ivOpen;
  for (const button of ['iv-save', 'iv-save-review']) $(button).disabled = true;
  message('iv-message', 'Saving to Notion…');
  try {
    const result = await iv.save(id);
    if (!result.ok) { message('iv-message', result.error, 'error'); return; }
    ivOpen = null;
    show($('iv-editor'), false);
    renderDrafts(await iv.drafts());
    message('iv-message', 'Saved to Notion 🎤 Interviews.', 'ok');
    await loadSaved();
    if (andReview) reviewRow(result.id);
  } finally {
    for (const button of ['iv-save', 'iv-save-review']) $(button).disabled = false;
  }
}

// Saved interviews, from Notion. Changing the job updates the row's Application there.
const reviewing = new Set();
const OUTCOME = {positive: 'Positive', neutral: 'Neutral', negative: 'Negative'};
const OUTCOME_TONE = {positive: 'good', neutral: 'warn', negative: 'bad'};
// While the library loads from Notion (like the Jobs list): a spinner in the empty table the first time;
// afterwards the rows stay and the subtitle says it's refreshing.
const IV_SAVED_TO = 'Saved to Notion 🎤 Interviews';
function showSavedLoading() {
  show($('iv-empty'), false);
  if (ivSavedRows.length) { $('iv-lib-stats').textContent = 'Refreshing from Notion…'; return; }
  const box = el('div', 'list-loading');
  box.append(el('span', 'spinner'), el('div', '', 'Loading your interviews from Notion…'),
    el('div', 'muted small', 'Interviews and their applications, usually a few seconds'));
  const td = Object.assign(document.createElement('td'), {colSpan: 5});
  td.append(box);
  const tr = document.createElement('tr');
  tr.append(td);
  $('iv-saved').replaceChildren(tr);
  $('iv-lib-stats').textContent = 'Loading from Notion…';
}
async function loadSaved() {
  showSavedLoading();
  const result = await iv.saved().catch(error => ({ok: false, error: String(error?.message || error)}));
  $('iv-lib-stats').textContent = IV_SAVED_TO;
  if (!result.ok) { ivSavedRows = []; $('iv-saved').replaceChildren(); show($('iv-empty')); $('iv-empty').textContent = result.error; return; }
  ivSavedRows = result.interviews;
  renderSaved();
}
function renderSaved() {
  closeMenu();
  const text = $('iv-filter').value.trim().toLowerCase(), outcome = $('iv-outcome').value;
  const rows = ivSavedRows.filter(row => {
    const job = row.application[0] ? jobForPage(row.application[0]) : null;
    const words = `${row.title} ${row.round || ''} ${row.next_step || ''} ${job?.title || ''} ${job?.company || ''}`.toLowerCase();
    return (!text || words.includes(text)) && (!outcome || (outcome === 'none' ? !row.overall : row.overall === outcome));
  });
  show($('iv-empty'), rows.length === 0);
  $('iv-empty').textContent = ivSavedRows.length ? 'No interview matches this filter.' : 'No interviews in Notion yet.';
  $('iv-saved').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    const cell = (...children) => { const td = document.createElement('td'); td.append(...children); tr.append(td); return td; };
    const job = row.application[0] ? jobForPage(row.application[0]) : null;
    cell(row.date ? new Date(`${row.date}T12:00:00`).toLocaleDateString([], {day: 'numeric', month: 'short', year: 'numeric'}) : '').className = 'iv-date';

    // Interview: company badge, the job (or the interview's own title), company · round, next step.
    const who = el('div', 'iv-who');
    const logo = avatar(job?.company || row.title);
    const badge = el('span', 'logo', logo.initials);
    badge.style.setProperty('--hue', logo.hue);
    const lines = el('div', '');
    lines.append(el('b', '', job ? job.title : row.title));
    const sub = [job?.company, row.round].filter(Boolean).join(' · ') || (job ? '' : 'No job linked');
    if (sub) lines.append(el('div', 'muted small', sub));
    lines.append(el('div', 'muted small', row.next_step ? `Next: ${row.next_step}` : 'Next step not stated'));
    who.append(badge, lines);
    // Change job…: the job picker, shown on the row when asked for from the menu.
    const picker = el('div', 'iv-picker');
    picker.hidden = true;
    const select = document.createElement('select');
    jobOptions(select, job?.url || '', row.application[0] && !job ? 'Linked in Notion (job not in this list)' : 'No job linked');
    if (row.application[0] && !job) select.value = '';
    const pasted = Object.assign(document.createElement('input'), {type: 'url', placeholder: 'https://… then Enter', hidden: true});
    const relink = async url => {
      select.disabled = pasted.disabled = true;
      message('iv-message', 'Linking in Notion…');
      const done = await iv.link(row.id, url);
      select.disabled = pasted.disabled = false;
      message('iv-message', done.ok ? `"${row.title}" is now ${url ? 'linked to that job' : 'not linked to a job'} in Notion.` : done.error, done.ok ? 'ok' : 'error');
      if (done.ok) {
        if (url && !shared.allJobs.some(j => j.url === url && j.notion_url)) { try { shared.allJobs = (await window.pilot.jobs()).jobs; } catch {} }  // just added to Applications
        loadSaved();
      }
    };
    select.addEventListener('change', () => {
      show(pasted, select.value === PASTE);
      if (select.value === PASTE) pasted.focus(); else relink(select.value);
    });
    pasted.addEventListener('change', () => { if (/^https?:\/\//.test(pasted.value.trim())) relink(pasted.value.trim()); });
    picker.append(select, pasted);
    cell(who, picker);

    // Where: the job in this list, else the linked Applications row (a job applied to outside Job Pilotto).
    const place = job || row.place || {};
    cell(placeAndMode(place.location, place.work_mode) || '–').className = 'iv-where';
    cell(row.overall ? pill(OUTCOME[row.overall] || row.overall, OUTCOME_TONE[row.overall] || 'neutral', {dot: true})
      : pill(reviewing.has(row.id) ? 'Reviewing…' : 'Not reviewed', reviewing.has(row.id) ? 'signal' : 'neutral', {dot: true}));

    // Actions: open the review (or get one), then the rest in ⋯.
    const actions = el('div', 'row-actions');
    let main;
    if (row.overall) {
      main = el('button', 'secondary iv-main', 'Open review');
      main.title = 'The review and transcript, in Notion';
      main.addEventListener('click', event => window.pilot.openNotion(row.url, event.metaKey));
    } else {
      main = Object.assign(el('button', 'secondary iv-main', reviewing.has(row.id) ? 'Reviewing…' : 'Review'), {disabled: reviewing.has(row.id),
        title: 'Claude reviews it question by question (about $0.05); the review is added to the Notion page'});
      main.addEventListener('click', () => reviewRow(row.id));
    }
    const menu = [
      {label: '↗ Open in Notion', run: event => window.pilot.openNotion(row.url, event.metaKey)},
      {label: 'Change job…', run: () => { picker.hidden = false; select.focus(); }, title: 'Link this interview to another job (updates Notion)'},
      '-',
      {label: 'Delete', danger: true, title: osText("Moves the row to Notion's trash (restorable for 30 days) and deletes its recording on this Mac"), run: async () => {
        if (!confirm(osText(`Delete "${row.title}"? It goes to Notion's trash (30 days) and its recording is removed from this Mac.`))) return;
        const done = await iv.remove(row.id);
        message('iv-message', done.ok ? osText(`Deleted "${row.title}": in Notion's trash for 30 days${done.removed ? ', its recording removed from this Mac' : ''}.`)
          : done.error, done.ok ? 'ok' : 'error');
        loadSaved();
      }},
    ];
    actions.append(main, moreButton(menu, 'More: open in Notion, change job, delete'));
    cell(actions);
    return tr;
  }));
}

async function reviewRow(pageId) {
  if (!shared.state.secrets?.ANTHROPIC_API_KEY) { message('iv-message', 'Add your Anthropic key in Settings to get reviews.', 'error'); return; }
  reviewing.add(pageId);
  message('iv-message', 'Claude is reviewing the interview (about a minute)…');
  loadSaved();
  const result = await iv.review(pageId);
  reviewing.delete(pageId);
  message('iv-message', result.ok ? `${result.summary}. The review is on the Notion page.` : result.error, result.ok ? 'ok' : 'error');
  loadSaved();
}

// Recorder: your microphone on the left channel, the call's audio (screen capture) on the right, so the
// transcript can tell which speaker is you. Without the call's audio it records the microphone alone.
let recorder = null;
// Record starts only with the call's audio (otherwise only your voice would be kept); the permission panel
// says what to allow. "Record my microphone only" is the explicit choice for in-person or speaker calls.
async function callAudio() {
  // Without macOS Screen & System Audio Recording permission the request may never answer: give up after 5 s.
  try {
    const request = navigator.mediaDevices.getDisplayMedia({audio: true, video: {frameRate: 1, width: 320, height: 200}});
    const call = await Promise.race([request, new Promise(resolve => setTimeout(() => resolve(null), 5000))]);
    if (!call) { request.then(late => late.getTracks().forEach(t => t.stop()), () => {}); return null; }
    if (!call.getAudioTracks().length) { call.getTracks().forEach(t => t.stop()); return null; }
    return call;
  } catch { return null; }
}

let levelListener = null;

async function startRecording(micOnly) {
  message('iv-message', '');
  if (!$('iv-consent').checked) { message('iv-message', 'First ask everyone on the call and tick the consent box.', 'error'); return; }
  if (recorder) return;
  $('iv-record').disabled = true;
  let call = null;
  const tap = !micOnly && await iv.tapAvailable();  // the call's audio through AudioTee, no screen capture
  if (!micOnly && !tap) {
    message('iv-message', 'Connecting to the call\'s audio…');
    call = await callAudio();
    if (!call) {
      message('iv-message', 'Not recording: allow the call\'s audio first (above), or choose Mic only.', 'error');
      await showPermission(true);
      $('iv-record').disabled = !$('iv-consent').checked;
      $('iv-permission').scrollIntoView({behavior: 'smooth', block: 'center'});
      return;
    }
    message('iv-message', '');
  }
  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}});
  } catch {
    call?.getTracks().forEach(t => t.stop());
    message('iv-message', 'Job Pilotto may not use the microphone yet: allow it (see above), then restart.', 'error');
    showPermission();
    $('iv-record').disabled = !$('iv-consent').checked;
    return;
  }
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const mono = stream => {
    const gain = context.createGain();
    Object.assign(gain, {channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers'});
    context.createMediaStreamSource(stream).connect(gain);
    return gain;
  };
  if (call) {
    const merger = context.createChannelMerger(2);
    mono(mic).connect(merger, 0, 0);
    mono(call).connect(merger, 0, 1);
    destination.channelCount = 2;
    merger.connect(destination);
  } else {
    destination.channelCount = 1;
    mono(mic).connect(destination);
  }
  const id = await iv.recordStart({stereo: !!call || tap});
  if (tap) {
    const tapped = await iv.tapStart(id);
    if (!tapped.ok) {
      mic.getTracks().forEach(t => t.stop());
      context.close();
      await iv.recordStop(id, 0);
      await iv.discard(id);
      message('iv-message', `Not recording: the call's audio couldn't start (${tapped.error}). Try again, or choose Mic only.`, 'error');
      $('iv-record').disabled = !$('iv-consent').checked;
      return;
    }
  }
  const media = new MediaRecorder(destination.stream, {mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: call ? 96000 : 48000});
  // AudioTee's level: the meter moves when the other people speak; flat for 20 s = likely no permission.
  let heard = false;
  const quiet = tap ? setTimeout(() => {
    if (!heard && recorder === media) {
      $('iv-sources').textContent = 'No call audio heard yet.';
      showPermission(true);
    }
  }, 20000) : null;
  levelListener = ({id: tapped, level}) => {
    if (tapped !== id) return;
    if (level > 0.02 && !heard) { heard = true; $('iv-sources').textContent = 'Your microphone and the call\'s audio'; show($('iv-permission'), false); }
    $('iv-meter-bar').style.width = `${Math.min(100, Math.round(Math.sqrt(level) * 140))}%`;
  };
  const started = Date.now();
  let writing = Promise.resolve();
  media.ondataavailable = event => {
    if (event.data.size) writing = writing.then(async () => iv.recordChunk(id, new Uint8Array(await event.data.arrayBuffer())));
  };
  const timer = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    $('iv-timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  media.onstop = async () => {
    clearInterval(timer);
    await writing;
    [mic, call].filter(Boolean).forEach(stream => stream.getTracks().forEach(track => track.stop()));
    context.close();
    clearTimeout(quiet);
    levelListener = null;
    await iv.recordStop(id, (Date.now() - started) / 1000, {micStartedAt});
    recorder = null;
    show($('iv-recorder'), false);
    $('iv-consent').checked = false;
    $('iv-record').disabled = true;
    openDraft(id);
  };
  media.start(5000);  // a chunk every 5 s goes to disk
  const micStartedAt = Date.now();
  recorder = media;
  $('iv-record').disabled = true;
  $('iv-timer').textContent = '00:00';
  $('iv-sources').textContent = call ? 'Your microphone and the call\'s audio' : tap ? 'Listening for the call\'s audio…' : 'Your microphone only (as you chose)';
  show($('iv-meter'), tap);
  $('iv-meter-bar').style.width = '0';
  show($('iv-permission'), false);
  show($('iv-recorder'));
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  const remind = await iv.remindGet().catch(() => ({on: true}));
  $('iv-remind').checked = remind.on;
  $('iv-remind').addEventListener('change', event => iv.remindSet(event.target.checked));
  window.pilot.onOpenInterviews(() => document.querySelector('.nav[data-view="interviews"]').click());
  $('iv-permission-open').addEventListener('click', () => iv.openPrivacy(permissionKind));
  $('iv-permission-restart').addEventListener('click', () => { if (!recorder) iv.relaunch(); });
  $('iv-title').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveOpenDraft, 600); });
  $('iv-text').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => { saveOpenDraft(); renderSpeakers(); }, 800); });
  $('iv-job').addEventListener('change', () => {
    show($('iv-job-url'), $('iv-job').value === PASTE);
    if ($('iv-job').value === PASTE) $('iv-job-url').focus(); else saveOpenDraft();
  });
  $('iv-job-url').addEventListener('change', saveOpenDraft);
  $('iv-close').addEventListener('click', async () => { await saveOpenDraft(); ivOpen = null; show($('iv-editor'), false); renderDrafts(await iv.drafts()); });

  $('iv-transcribe-go').addEventListener('click', async () => {
    const id = ivOpen;
    await saveOpenDraft();
    message('iv-message', '');
    show($('iv-transcribe'), false);
    show($('iv-progress'));
    $('iv-progress-text').textContent = 'Starting';
    $('iv-progress-bar').style.width = '2%';
    const meta = await iv.transcribe(id, {speakers: Number($('iv-count').value)});
    if (ivOpen === id) openDraft(id);
    if (meta.status !== 'ready') message('iv-message', meta.error || 'Transcription failed', 'error');
  });
  window.pilot.onInterviewProgress(({id, percent, text}) => {
    if (id !== ivOpen) return;
    show($('iv-progress'));
    $('iv-progress-text').textContent = text;
    $('iv-progress-percent').textContent = percent == null ? '' : `${percent}%`;
    if (percent != null) $('iv-progress-bar').style.width = `${Math.max(2, percent)}%`;
  });

  $('iv-add').addEventListener('click', async () => {
    const draft = await iv.add();
    if (!draft) return;
    if (draft.error) { message('iv-message', draft.error, 'error'); return; }
    message('iv-message', '');
    openDraft(draft.id);
  });
  $('iv-save').addEventListener('click', () => saveToNotion(false));
  $('iv-save-review').addEventListener('click', () => saveToNotion(true));
  $('iv-discard').addEventListener('click', async () => {
    if (!ivOpen) return;
    await iv.discard(ivOpen);
    ivOpen = null;
    show($('iv-editor'), false);
    renderDrafts(await iv.drafts());
  });
  $('iv-filter').addEventListener('input', renderSaved);
  $('iv-outcome').addEventListener('change', renderSaved);
  $('iv-refresh').addEventListener('click', loadSaved);
  $('iv-recordings').addEventListener('click', () => iv.recordings());
  // Consent first: Record stays off until the box is ticked, and the tick is asked again for every call.
  $('iv-consent').addEventListener('change', () => { $('iv-record').disabled = !$('iv-consent').checked || !!recorder; });

  $('iv-record').addEventListener('click', () => startRecording(false));
  $('iv-mic-only').addEventListener('click', () => startRecording(true));
  window.pilot.onCallLevel(level => levelListener?.(level));
  $('iv-stop').addEventListener('click', () => recorder?.state === 'recording' && recorder.stop());
}

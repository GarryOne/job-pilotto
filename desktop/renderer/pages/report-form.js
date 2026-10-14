// "Report this form" in the app window (spec docs/superpowers/specs/2026-10-15-report-this-form.md §3): the switch in Settings, the "Report this form…" button on a session (also in ⌘K), and the dialog.
// The dialog has two faces: how to start (the flag at the bottom left of the application's Chrome page) and what would be sent (hosts the person can drop, counts, what was removed, what is never sent),
// with Cancel focused. Everything shown is counts and hosts: no page text, no value. lib/report-handlers.js holds the record; Send and Cancel come back to it. Guard: test/report-panel.test.js.
import {$} from './core.js';
import {el} from '../components.js';

const size = bytes => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const foot = (...buttons) => $('report-foot').replaceChildren(...buttons);
const button = (label, kind, onClick, extra = {}) => Object.assign(el('button', kind, label), {type: 'button', onclick: onClick}, extra);
const open = () => { if (!$('report-dialog').open) $('report-dialog').showModal(); };
const close = () => $('report-dialog').close();

// The line in Settings about what this install has sent (and may delete).
async function sent() {
  const {count} = await window.pilot.reportFormSent().catch(() => ({count: 0}));
  $('report-sent-row').hidden = !count;
  $('report-sent-count').textContent = `${plural(count, 'report')} you sent ${count === 1 ? 'is' : 'are'} kept on our server for up to 30 days.`;
}

function howTo() {
  $('report-body').replaceChildren(
    el('p', 'dialog-lead', 'When an application gets stuck, a flag appears at the bottom left of its page in Chrome, next to Stop. Press it, read what will happen, and repeat the step that gets stuck while Job Pilotto records what the site sends.'),
    el('p', 'muted small', 'Nothing is recorded until you press Start recording there, and nothing leaves your Mac until you read what would be sent here and press Send. Chrome shows its "debugging this browser" bar while it records.'));
  foot(button('OK', 'primary', close));
  open();
}

function preview({id, preview: data}) {
  const dropped = new Set();
  const hosts = el('div', 'review-groups');
  for (const one of data.hosts) {
    const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: true});
    box.addEventListener('change', () => { if (box.checked) dropped.delete(one.host); else dropped.add(one.host); });
    const row = el('label', 'check-row');
    row.append(box, el('span', '', `${one.host} · ${plural(one.responses, 'response')}, ${size(one.bytes)}`));
    hosts.append(row);
  }
  const r = data.removed || {}, removed = [[r.typed, plural(r.typed || 0, 'typed-value field')], [r.own, `${r.own} of your own value${r.own === 1 ? '' : 's'}`], [r.contacts, plural(r.contacts || 0, 'e-mail or phone')],
    [r.images, plural(r.images || 0, 'image')], [r.binary, `${r.binary} file${r.binary === 1 ? '' : 's'} that ${r.binary === 1 ? 'is' : 'are'} not text`], [r.dropped, plural(r.dropped || 0, 'tracker or media request')]]
    .filter(([n]) => n).map(([, text]) => text);
  const gone = el('p', 'small', el('b', '', 'Removed: '));
  gone.append(`${removed.concat('cookies and headers').join(' · ')}`);
  $('report-body').replaceChildren(
    el('p', 'dialog-lead', 'This is what will be sent, encrypted before it leaves this Mac and deleted after 30 days. Untick a site to leave its responses out (the report may then not replay).'),
    hosts,
    el('p', 'muted small', `${plural(data.responses, 'response')}, ${size(data.bytes)}`),
    gone,
    el('p', 'muted small', 'Never sent: what you typed, passwords, cookies, your CV or your profile.'));
  const send = button('Send report', 'secondary', async () => {
    send.disabled = true; send.textContent = 'Sending…';
    const answer = await window.pilot.reportFormSend([...dropped]).catch(error => ({ok: false, error: error.message}));
    $('report-body').replaceChildren(el('p', 'dialog-lead', answer?.ok ? 'Sent. Thank you: it is encrypted, and you can delete it any time in Settings.' : (answer?.error || 'It could not be sent.')));
    foot(button('OK', 'primary', close));
    sent();
  });
  foot(button('Cancel', 'primary', async () => { await window.pilot.reportFormCancel(); close(); }, {autofocus: true}), send);
  open();
}

export async function init() {
  const state = await window.pilot.reportFormGet().catch(() => ({on: true, ready: false}));
  const show = (on, ready) => { $('setting-report-form').hidden = !ready; $('ss-report').hidden = !(on && ready); };
  show(state.on, state.ready);
  $('report-form-on').checked = state.on;
  $('report-form-on').addEventListener('change', async event => { const {on} = await window.pilot.reportFormSet(event.target.checked); show(on, true); });
  $('report-delete').addEventListener('click', async () => { $('report-delete').disabled = true; await window.pilot.reportFormDeleteAll().catch(() => null); $('report-delete').disabled = false; sent(); });
  sent();
  $('ss-report').addEventListener('click', howTo);
  window.pilot.onReportFormReady(preview);
  if (state.shown) preview(state.shown);
}

export {howTo as showHowTo, preview as showPreview};   // what the window runs on a press or when the app hands over a recording (also how the screenshots call them)

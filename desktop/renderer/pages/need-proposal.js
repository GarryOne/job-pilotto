// "Needs your attention", a field the form still has empty, with its proposed answer back (owner, 8 Oct 2026: "we had this, it got
// overwritten": the 30 Sep rows proposed Claude's answer, but only from Claude's message, so once Apply went through the extension the
// rows were bare). The answer comes from what the fill proposed for that field (extension/page/propose.js, reported with what is left),
// else, for a contact detail you have not given, from your CV (lib/contact-from-cv.js). "Use" fills it in the form through the
// extension and keeps it for future forms (a contact detail in Your details, any other answer in your Answers). Guarded by
// test/need-proposal.test.js.
import {el} from '../components.js';
import {renderSessionPage} from './session-log.js';
import {badge, reviewStates, showInForm, smallButton, titleLine} from './session-needs.js';
import {pickProposal} from '../proposal-pick.js';

// What the row needs besides the form's report, asked once per window and kept: your details, the CV's proposals, and which detail a
// label asks for (Claude reads the labels the extension doesn't know: lib/contact-keys.js).
let contact = null, fromCv = null;
const keyOf = new Map(), asking = new Set();
let askTimer = null;
function load() {
  if (contact) return;
  contact = {}; fromCv = [];
  window.pilot.contact().then(found => { contact = found || {}; renderSessionPage(); }).catch(() => {});
  window.pilot.contactProposals({}).then(result => { fromCv = result?.proposals || []; if (fromCv.length) renderSessionPage(); }).catch(() => {});
}
function askKey(label) {
  if (keyOf.has(label) || asking.has(label) || /^\d+ more fields?$/.test(label)) return;
  asking.add(label);
  clearTimeout(askTimer);
  askTimer = setTimeout(() => {   // the labels of one redraw, in one call
    const labels = [...asking];
    asking.clear();
    window.pilot.contactKeysFor(labels).then(keys => { for (const label of labels) keyOf.set(label, keys?.[label] || ''); renderSessionPage(); })
      .catch(() => { for (const label of labels) keyOf.set(label, ''); });
  }, 200);
}

// → {value, key, from} or null (proposal-pick.js decides).
export function proposalFor(item, label) {
  load();
  const proposals = reviewStates.get(item.id)?.proposals || [];
  const reported = proposals.find(proposal => proposal.label === label);
  if (!reported?.value && !reported?.key) askKey(label);
  return pickProposal({proposals, label, key: keyOf.get(label) || '', contact, cv: fromCv});
}

// What "Use" did, per session and field, so a redraw (the page redraws often) keeps saying it. A field the form did not take after a few
// seconds (a menu that needs your click) gets its answer copied and an Open in form.
const used = new Map();   // `${id}|${label}` -> {at, kept}
const TAKES_MS = 5000;

export function proposedRow(item, label, proposal, now = Date.now()) {
  const li = el('li', 'ss-need is-ask'), body = el('div', 'ss-need-body'), actions = el('span', 'ss-need-actions'), line = el('div', 'ss-ask-line');   // askRow's layout
  li.dataset.empty = label;
  const key = `${item.id}|${label}`, tried = used.get(key);
  const input = el('input', 'ss-ask-input');
  input.type = 'text';
  input.placeholder = 'Your answer';
  input.value = tried?.value || proposal.value;
  const note = el('span', 'ss-need-desc small', proposal.from);
  line.append(input, actions);
  body.append(titleLine(label.replace(/\s*\*\s*$/, '')), note, line);
  li.append(badge(), body);
  if (tried && now - tried.at >= TAKES_MS) {   // still empty in the form after Use
    note.textContent = 'The form didn\'t take it: the answer is copied, paste or pick it there';
    actions.append(smallButton('Open in form', 'secondary is-signal', event => showInForm(item, label, event.currentTarget)));
    return li;
  }
  if (tried) {
    input.disabled = true;
    note.textContent = tried.kept ? 'Filled in the form · remembered for future forms' : 'Filled in the form (not remembered: Notion didn\'t answer)';
    li.classList.add('is-done');
    return li;
  }
  const use = smallButton('Use', 'primary', async () => {
    const value = input.value.trim();
    if (!value) { note.textContent = 'Write an answer first'; input.focus(); return; }
    use.disabled = input.disabled = true;
    const filled = await window.pilot.sessionFillField(item.id, label, value).catch(error => ({ok: false, error: error.message}));
    if (!filled?.ok) { use.disabled = input.disabled = false; note.textContent = filled?.error || 'Couldn\'t reach the form'; return; }
    // Kept for every later form: a contact detail in Your details, any other answer in your Answers (Notion).
    const already = proposal.key && String(contact?.[proposal.key] || '') === value;   // your saved detail, unchanged: nothing to write
    const kept = already ? {ok: true} : await (proposal.key ? window.pilot.saveContactField(proposal.key, value) : window.pilot.rememberAnswer(label, value)).catch(() => ({ok: false}));
    if (proposal.key && kept?.ok) contact = {...contact, [proposal.key]: value};
    used.set(key, {at: Date.now(), value, kept: !!kept?.ok});
    setTimeout(() => { if ((reviewStates.get(item.id)?.pending || []).includes(label)) { navigator.clipboard?.writeText(value).catch(() => {}); renderSessionPage(); } }, TAKES_MS);
    renderSessionPage();
  });
  actions.append(use);
  return li;
}
export const _used = used;   // tests

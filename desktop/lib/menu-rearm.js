// A menu the fill could not answer from its choices ("Sir" asked, "Madame"/"Monsieur" shown; or Chrome's page translation showing
// "Madam"/"Sir" for an answer "Monsieur", owner 8 Oct 2026): as soon as the form reports the choices it showed, Claude picks the one that
// means the same (lib/option-pick.js) and the menu is armed again with it, so your next click on it picks the right one. Once per field,
// answer and choices. Logged: which session and field, never the answer. Guarded by test/option-pick.test.js.
import {pickOption} from './option-pick.js';
import {rememberChoice} from './menu-choices.js';

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
// The choice is remembered, and the menu armed with it again while the field stays empty: a fill still running re-arms the menu with its raw
// answer when it ends and overwrote the choice (8 Oct 2026, the live twin: "+41" asked, "Suisse" chosen, then "+41" again: "pick it yourself").
// Checked GAP_MS after each arming against the latest form state seen (listeners only hear changes, and an empty menu changes nothing);
// at most AGAIN more times; never a new AI call.
export const GAP_MS = 10 * 1000, AGAIN = 3;
export function menuRearm({storage, client, queueFill, log = () => {}, later = (fn, ms) => setTimeout(fn, ms)}) {
  const done = new Set(), latest = new Map();   // key; session id -> the last form state seen
  const arm = (id, label, choice, times, why) => {
    queueFill(id, label, choice);
    log('fill', why, {id, field: String(label).slice(0, 60), times});
    if (times > AGAIN) return;
    later(() => { if ((latest.get(id)?.pending || []).includes(label)) arm(id, label, choice, times + 1, 'menu armed again: the field is still empty'); }, GAP_MS);
  };
  return state => {
    if (state?.id) latest.set(state.id, state);
    for (const proposal of state?.proposals || []) {
      if (!proposal.value || !proposal.options?.length || proposal.options.some(option => same(option, proposal.value))) continue;
      const key = `${state.id}|${state.tab ?? ''}|${proposal.label}|${proposal.value}|${proposal.options.join('|')}`;   // a form reopened in a new tab is asked again
      if (done.has(key)) continue;
      done.add(key);
      pickOption(storage, proposal, {client: client(), log}).then(({choice}) => {
        if (!choice) return;
        rememberChoice(storage, {url: state.url, label: proposal.label, value: proposal.value, choice});   // the next fill on this site tries it first
        arm(state.id, proposal.label, choice, 1, 'menu armed again with the choice that means the same');
      });
    }
  };
}

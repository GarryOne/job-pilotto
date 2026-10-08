// A menu the fill could not answer from its choices ("Sir" asked, "Madame"/"Monsieur" shown; or Chrome's page translation showing
// "Madam"/"Sir" for an answer "Monsieur", owner 8 Oct 2026): as soon as the form reports the choices it showed, Claude picks the one that
// means the same (lib/option-pick.js) and the menu is armed again with it, so your next click on it picks the right one. Once per field,
// answer and choices. Logged: which session and field, never the answer. Guarded by test/option-pick.test.js.
import {pickOption} from './option-pick.js';

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
export function menuRearm({storage, client, queueFill, log = () => {}}) {
  const done = new Set();
  return state => {
    for (const proposal of state?.proposals || []) {
      if (!proposal.value || !proposal.options?.length || proposal.options.some(option => same(option, proposal.value))) continue;
      const key = `${state.id}|${proposal.label}|${proposal.value}|${proposal.options.join('|')}`;
      if (done.has(key)) continue;
      done.add(key);
      pickOption(storage, proposal, {client: client(), log}).then(({choice}) => {
        if (!choice) return;
        queueFill(state.id, proposal.label, choice);
        log('fill', 'menu armed again with the choice that means the same', {id: state.id, field: String(proposal.label).slice(0, 60)});
      });
    }
  };
}

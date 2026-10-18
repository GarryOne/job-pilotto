// Fill now's yes (owner, 18 Oct 2026: filling again a job you opened "should be possible, but with a confirmation popup"): the app's dialog parts (the head, icon and close of the
// Watch the fill popup) with what would be filled and what it replaces; the answer is the promise's. Escape or × is a no. Guard: test/ready-card.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';

// ask: {again, jobs: [{code, name}], replaces}. -> Promise<boolean>
export function confirmFill(ask) {
  return new Promise(resolve => {
    const dialog = el('dialog', 'save-dialog panel-dialog cv-dialog ready-confirm');
    dialog.id = 'ready-confirm';
    const head = el('div', 'dialog-head'), lead = el('div', 'cv-head'), tile = el('span', 'dialog-icon');
    tile.append(icon('moon'));
    const n = ask.jobs.length, forms = count => `${count} form${count === 1 ? '' : 's'}`;
    lead.append(el('h2', '', ask.again ? `Fill ${n === 1 ? 'this job' : `these ${n} jobs`} again?` : `Fill ${forms(n)} now?`),
      el('p', 'muted', ask.again ? `The server fills ${n === 1 ? 'it' : 'them'} again from the start; nothing is submitted.` : 'The server fills them now; nothing is submitted.'));
    const close = el('button', 'ghost icon-btn', '');
    close.id = 'ready-confirm-close'; close.type = 'button'; close.setAttribute('aria-label', 'Close');
    close.append(icon('close'));
    head.append(tile, lead, close);
    const list = el('ul', 'ready-confirm-list');
    for (const job of ask.jobs) list.append(el('li', '', job.name || job.code));
    const parts = [head, list];
    if (ask.replaces) parts.push(el('p', 'message', `This replaces ${forms(ask.replaces)} from this night still waiting for you: open or finish ${ask.replaces === 1 ? 'it' : 'them'} first if you need ${ask.replaces === 1 ? 'it' : 'them'}.`));
    const foot = el('div', 'dialog-foot'), buttons = el('span', 'inline');
    const no = el('button', 'ghost', 'Cancel'), yes = el('button', 'primary', ask.again ? 'Fill again' : 'Fill now');
    no.id = 'ready-confirm-no'; yes.id = 'ready-confirm-yes'; no.type = yes.type = 'button';
    buttons.append(no, yes);
    foot.append(el('span', 'muted small', 'Nothing is submitted.'), buttons);
    dialog.append(...parts, foot);
    let answered = false;
    const answer = value => { if (answered) return; answered = true; if (dialog.open) dialog.close?.(); dialog.remove(); resolve(value); };
    dialog.addEventListener('close', () => answer(false));   // Escape
    close.addEventListener('click', () => answer(false));
    no.addEventListener('click', () => answer(false));
    yes.addEventListener('click', () => answer(true));
    document.body.append(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  });
}

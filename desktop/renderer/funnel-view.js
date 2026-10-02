// Focus → the two funnel cards (Application funnel: jobs you went after; Inbound funnel: opportunities that found
// you): each step's name, count, bar and share, a click shows those opportunities in the Jobs list.
import {el} from './components.js';
import {icon} from './icons.js';

// The Inbound funnel card's steps (src/focus.py funnel()['inbound']): share of those who contacted you, and the Jobs
// list a click shows (its label and links). Empty when nothing found you yet: no card.
export function inboundSteps(inbound) {
  const steps = inbound?.steps || [];
  const contacted = steps[0]?.reached || 0;
  if (!contacted) return [];
  return steps.map((step, i) => {
    const name = step.step.replace(/^\S+\s/, '');
    const share = Math.round(100 * step.reached / contacted);
    return {name, reached: step.reached, share, urls: step.urls || [],
      label: i ? `Inbound: ever reached ${name}` : 'Inbound: contacted you',
      title: i ? `${step.reached} of the ${contacted} who contacted you ever reached ${name.toLowerCase()} (${share}%)`
        : `${contacted} opportunities found you: a recruiter, a LinkedIn message, a call`};
  });
}

// A new account has no applications, yet the engine returns its steps (all at 0): the card then says it fills in later.
export const EMPTY_FUNNEL_HINT = 'Fills in as you prepare and send applications.';
export const funnelIsEmpty = steps => !(steps || []).some(step => step.reached > 0);

// The list items of one funnel: a step, an arrow, a step… open(label, urls) runs on a click (or Enter) on a step
// that has links.
export function funnelSteps(steps, open) {
  const nodes = [];
  steps.forEach(({name, reached, share, title, label, urls, weak}, i) => {
    if (i) {
      const arrow = Object.assign(el('li', 'funnel-arrow'), {ariaHidden: 'true'});
      arrow.append(icon('chevron'));
      nodes.push(arrow);
    }
    const li = el('li', `funnel-step${weak ? ' is-weak' : ''}`);
    const bar = el('div', 'funnel-bar');
    const fill = el('span', '');
    fill.style.width = `${Math.max(share, reached ? 4 : 0)}%`;
    bar.append(fill);
    li.title = title;
    li.append(el('span', 'funnel-name', name), el('b', 'funnel-count', String(reached)), bar, el('span', 'muted small', `${share}% reached`));
    if (urls?.length) {
      li.classList.add('is-link');
      Object.assign(li, {tabIndex: 0, role: 'button'});
      li.title += '. Click to see them';
      li.addEventListener('click', () => open(label, urls));
      li.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(label, urls); } });
    }
    nodes.push(li);
  });
  return nodes;
}

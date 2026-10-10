// The drawer's tab strip (job-drawer's header sits above it): the eight tabs in their fixed order (renderer/job-page-view.js TABS), the
// active one underlined; on a narrow window the strip scrolls sideways instead of wrapping. Guarded by test/job-drawer.test.js.
import {el} from '../components.js';

export function tabStrip(tabs, active, pick) {
  const strip = el('div', 'tabs jd-tabs');
  strip.setAttribute('role', 'tablist');
  for (const [key, label] of tabs) {
    const node = Object.assign(el('button', key === active ? 'is-active' : '', label), {type: 'button'});
    node.dataset.jobTab = key;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(key === active));
    node.addEventListener('click', () => pick(key));
    strip.append(node);
  }
  return strip;
}

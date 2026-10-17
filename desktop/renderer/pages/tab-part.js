// A conditional part of a Settings → Profile tab ("Which is right?", the unsaved-changes bar of Your details, "Your CV changed"): shown only when
// it is wanted AND its tab (data-profile-panel) is the open one, so a part never leaks onto another tab; pages/profile.js profileTab keeps a
// part's wish (data-wanted) when the tab changes. Guarded by test/profile-tab-parts.test.js.
import {show} from './core.js';

const openTab = () => document.querySelector('[data-profile-tab].is-active')?.dataset.profileTab;

export function showOnTab(node, on) {
  if (!node) return;
  node.dataset.wanted = on ? '1' : '0';
  show(node, Boolean(on) && node.dataset.profilePanel === openTab());
}

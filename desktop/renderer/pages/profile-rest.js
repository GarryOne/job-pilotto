// Settings → Profile → the rest of the Profile page (education, role history, links, notes), line by line, on every store, through
// pages/outline-tab.js's save bar. The job preferences moved to Strategy → Job preferences (pages/job-preferences.js, owner 17 Oct 2026); these
// lines get their own homes next (spec 2026-10-17-base-facts.md, box "Preferences tab removed"). Guarded by test/profile-tabs-render.test.js.
import {el} from '../components.js';
import {shown} from '../answers-model.js';
import {readProfile} from '../preferences-model.js';
import {isDetailsHeading} from '../details-headings.js';
import {lineInput, outlineTab} from './outline-tab.js';

const TEXT = 'profile';
const typed = new Map();
let tab = null;

function draw(view, into) {
  // Your details' own sections are edited there (one editor per value): left out, with their lines.
  let mine = true;
  const rest = readProfile(view.items[TEXT] || []).rest.filter(entry => (entry.heading ? (mine = !isDetailsHeading(entry.heading)) : mine));
  const grid = el('div', 'form-grid cols-2 pref-body');
  for (const entry of rest) grid.append(entry.heading ? el('h5', 'span-all pref-sub', shown(entry.heading)) : lineInput(view, TEXT, entry, typed));
  if (!rest.length) grid.append(el('p', 'muted span-all', 'Nothing else on your Profile page.'));
  into.append(grid);
}

export async function loadProfileRest() {
  const node = document.getElementById('profile-rest-body');
  if (!node) return;
  if (!tab || tab.node !== node) tab = {...outlineTab('profilerest', [TEXT], node, draw, {onReset: () => typed.clear(), words: 'Scores, kits and tailored CVs use them once you save.'}), node};
  await tab.load();
}

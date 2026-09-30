// ⌘F on every page: a small find bar (top right) that highlights what the page shows (CSS Highlight API) and scrolls to each
// match. Enter / ⇧Enter or ⌘G / ⇧⌘G move between matches, Esc closes. The bar itself is never searched. The Jobs filter
// box still searches every job; this finds what is on screen.
import {countText, offsets, step} from '../find-bar.js';
import {$} from './core.js';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG']);
let ranges = [], index = -1;

// Every visible text match in the page, as Ranges (the find bar and hidden parts left out).
function collect(query) {
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {acceptNode: node => {
    const parent = node.parentElement;
    if (!parent || SKIP.has(parent.tagName) || parent.closest('#find-bar, [hidden], dialog:not([open])')) return NodeFilter.FILTER_REJECT;
    return parent.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
  }});
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const at of offsets(node.data, query)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + query.length);
      found.push(range);
    }
  }
  return found;
}
function paint() {
  if (!globalThis.CSS?.highlights) return;
  CSS.highlights.set('find', new Highlight(...ranges));
  if (index >= 0) CSS.highlights.set('find-active', new Highlight(ranges[index])); else CSS.highlights.delete('find-active');
  const active = ranges[index]?.startContainer?.parentElement;
  active?.scrollIntoView({block: 'center', inline: 'nearest'});
  const query = $('find-text').value;
  $('find-bar').dataset.count = countText({active: index + 1, total: ranges.length}, query);
  $('find-bar').classList.toggle('is-none', !!query.trim() && !ranges.length);
}
function search(how) {
  const query = $('find-text').value;
  ranges = collect(query);  // read again each time: the page may have changed since
  index = how === 'type' ? (ranges.length ? 0 : -1) : step(index, ranges.length, how);
  paint();
}
function clear() {
  ranges = []; index = -1;
  globalThis.CSS?.highlights?.delete('find');
  globalThis.CSS?.highlights?.delete('find-active');
  $('find-bar').dataset.count = '';
  $('find-bar').classList.remove('is-none');
}
function open() {
  $('find-bar').hidden = false;
  $('find-text').focus();
  $('find-text').select();
  if ($('find-text').value.trim()) search('type');
}
function close() { $('find-bar').hidden = true; clear(); }

export function init() {
  window.pilot.onFind(what => (what === 'open' || $('find-bar').hidden ? open() : search(what)));
  $('find-text').addEventListener('input', () => ($('find-text').value.trim() ? search('type') : clear()));
  $('find-text').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); search(event.shiftKey ? 'previous' : 'next'); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  $('find-prev').addEventListener('click', () => search('previous'));
  $('find-next').addEventListener('click', () => search('next'));
  $('find-close').addEventListener('click', close);
}

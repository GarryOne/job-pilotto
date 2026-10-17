// ⌘K entries for buttons: listed also while their task runs, and choosing one brings you to the button (scroll, focus, a pulse) without pressing it (tests: palette-running-task.test.js).

// The entry a button gets in ⌘K, or null when it is not offered. A button off for any other reason (no Notion link, a missing setup) is not offered;
// one that runs-page.js syncRunButtons turned off (data-run-busy) is, with a hint that it runs now.
export function buttonEntry(node, entry) {
  if (node.disabled && !node.dataset.runBusy) return null;
  return node.dataset.runBusy ? {...entry, hint: 'Running now: take a look at its card'} : entry;
}

// Bring a button into view: its card scrolls to the middle, the button takes focus, the card pulses once (.palette-flash in components.css).
export function reveal(node) {
  const card = node.closest('.task-card, .service-card, .setting, .card') || node;
  card.scrollIntoView({block: 'center'});
  node.focus({preventScroll: true});
  card.classList.remove('palette-flash');
  void card.offsetWidth;   // restart the animation when the same card is chosen twice
  card.classList.add('palette-flash');
  card.addEventListener('animationend', () => card.classList.remove('palette-flash'), {once: true});
}

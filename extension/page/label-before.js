// A box's own label when the page's <label for="…"> names no element (12 Oct 2026, a French form: "Prénom" / "Nom" labels whose `for` ids no box has, boxes named
// by the page's own field names, one of them pointing the wrong way). Structure only: the label that sits right before the box in the same flow (no other text or
// control between them, up through up to three wrappers), tied to no control. One rule for the fill (page/fill-labels.js) and the panel (review.js), loaded in both worlds.
// Guarded by worker/test/label-before.test.js and the recorded cases that load the fill.
(() => {
  if (window.__jobPilottoLabelBefore) return;
  const CONTROL = 'input:not([type=hidden]), select, textarea, button';
  const text = el => String(el.textContent || '').replace(/\s+/g, ' ').trim();
  window.__jobPilottoLabelBefore = el => {
    for (let node = el, hops = 0; node && hops < 4; node = node.parentElement, hops++) {
      for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
        if (prev.nodeType === 3) { if (prev.textContent.trim()) return ''; continue; }   // words between the label and the box: not its label
        if (prev.nodeType !== 1) continue;
        const isLabel = prev.tagName === 'LABEL';
        if (!isLabel && !text(prev) && !prev.querySelector(CONTROL)) continue;   // <br>, an empty <div></div>, a hidden input: no one's label
        if (!isLabel || prev.control || prev.querySelector(CONTROL) || !text(prev)) return '';
        return text(prev);
      }
      if (node.parentElement && node.parentElement.querySelectorAll(CONTROL).length > 1) return '';   // a wrapper holding other boxes: the label before it is theirs too
    }
    return '';
  };
})();

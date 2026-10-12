// A box's own label when the page's <label for="…"> names no element (12 Oct 2026, a French form: "Prénom" / "Nom" labels whose `for` ids no box has, boxes named
// by the page's own field names, one of them pointing the wrong way). Structure only: the label that sits right before the box in the same flow (no other text or
// control between them, up through up to three wrappers), tied to no control. One rule for the fill (page/fill-labels.js) and the panel (review.js), loaded in both worlds.
// The title of a group or of a control with no label is the same rule's sibling (12 Oct 2026, widget zoo segmented-toggle-1: a role=group named by aria-labelledby was called
// "First name", the FIRST label of its form, by a walk up its ancestors; the question was never asked and two fields shared one label): its own accessible name
// (aria-labelledby, aria-label) wins, else the NEAREST title before it that no other control owns (a <label for> of another box is that box's). One rule for every
// reader that names a group: page/radios.js, page/controls.js, page/fill-labels.js, review.js. Guarded by worker/test/label-before.test.js and the widget zoo.
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
  const TITLE = 'label, legend, [class*=title], [class*=heading]';
  // A title element tied to another control: a <label> whose control (for, or a box inside it) is not this element and not inside it.
  const othersLabel = (label, el) => label.tagName === 'LABEL' && !!label.control && label.control !== el && !el.contains(label.control);
  // The nearest title before el, a few boxes up: never inside el, never after it, never another control's label. -> the element, or null. selector: what counts as a title.
  window.__jobPilottoTitleAbove = (el, selector = TITLE, levels = 5) => {
    for (let up = el.parentElement, i = 0; up && i < levels; up = up.parentElement, i++) {
      const before = [...up.querySelectorAll(selector)].filter(found => !el.contains(found) && !found.contains(el) && text(found) && !othersLabel(found, el)
        && (el.compareDocumentPosition(found) & Node.DOCUMENT_POSITION_PRECEDING));
      if (before.length) return before[before.length - 1];
    }
    return null;
  };
  // A group's own accessible name: the words of the elements its aria-labelledby names, else its aria-label. -> {text, el} or null.
  // Its words read as the panel reads a label: a required star and its spoken twin ("Required", "Pflichtfeld") left out (page/required-mark.js clean); the element keeps the mark.
  const words = node => (window.__jobPilottoRequired?.clean ? text({textContent: window.__jobPilottoRequired.clean(node)}) : text(node));
  window.__jobPilottoOwnName = group => {
    const named = String(group.getAttribute?.('aria-labelledby') || '').split(/\s+/).map(id => id && document.getElementById(id)).filter(Boolean);
    const said = named.map(words).join(' ').trim();
    if (said) return {text: said, el: named[0]};
    const label = String(group.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
    return label ? {text: window.__jobPilottoRequired?.clean ? window.__jobPilottoRequired.clean(label) : label, el: group} : null;
  };
  // A group's title: its own accessible name, else the nearest title before it. -> {text, el} or null (el: where a required mark would sit).
  window.__jobPilottoGroupTitle = (group, selector = TITLE) => {
    const own = window.__jobPilottoOwnName(group);
    if (own) return own;
    const found = window.__jobPilottoTitleAbove(group, selector);
    return found ? {text: text(found), el: found} : null;
  };
})();

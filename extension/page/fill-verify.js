// Rung 0 of the fill ladder, the page's side (spec docs/superpowers/specs/2026-10-12-fill-ladder.md): the text boxes the fill answered that did not take the answer
// (page/fill.js notes them: "answer given, but the field did not take it") are listed with their spot, so the worker types them again for real (extension/fill-verify.js),
// and each is read back after. Only plain text boxes: never a password, a read-only or disabled box, a menu's search box (combo-click.js owns those) or a select.
// Values stay in the page: the worker gets the text to type for the box it clicks, never a list of values to report. Guard: worker/test/fill-verify.test.js.
(() => {
  if (window.__jobPilottoFillVerifyLoaded) return;
  window.__jobPilottoFillVerifyLoaded = true;
  const notTaken = new Map();   // field (id or name) -> the answer the fill gave it
  const TEXT = 'input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number], input[type=search], textarea';
  const alnum = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const holds = (el, value) => { const want = alnum(value), now = alnum(el?.value); return !!want && (now === want || now.includes(want)); };
  const byField = field => Array.from(document.querySelectorAll('input, textarea')).find(el => el.id === field || el.name === field);
  const typable = el => !!el && el.matches(TEXT) && !el.disabled && !el.readOnly && el.getAttribute('role') !== 'combobox'
    && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  window.__jobPilottoNoteNotTaken = (field, value) => { if (field && typeof value === 'string' && value.trim()) notTaken.set(String(field), value); };
  // -> [{field, x, y, text}] for each noted box that is typable and still does not hold its answer (at most 8), scrolled into view first.
  window.__jobPilottoNotTakenSpots = () => {
    const spots = [];
    for (const [field, text] of notTaken) {
      const el = byField(field);
      if (!typable(el) || holds(el, text) || spots.length >= 8) continue;
      el.scrollIntoView({block: 'center', inline: 'nearest'});
      const box = el.getBoundingClientRect();
      spots.push({field, x: Math.round(box.left + Math.min(box.width / 2, 40)), y: Math.round(box.top + box.height / 2), text: text.slice(0, 200)});
    }
    return spots;
  };
  // After the real typing: leave the box the way a person would (it loses focus), then say whether it holds the answer now; a box that does is marked as the fill's.
  window.__jobPilottoTakenNow = field => {
    const el = byField(field), text = notTaken.get(field);
    if (!el) return false;
    el.blur();
    const taken = holds(el, text);
    if (taken) { el.setAttribute('data-jobpilotto-filled', ''); el.setAttribute('data-jobpilotto-typed', alnum(text).slice(0, 160)); notTaken.delete(field); }
    return taken;
  };
})();

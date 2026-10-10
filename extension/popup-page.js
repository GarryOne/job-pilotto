// Runs inside a page (injected by consent.js): finds a popup in the way (a dialog, a modal, a layer fixed over the page: a cookie notice, a newsletter
// offer, an alert prompt, a chat invitation) by STRUCTURE only, lists its text and its own buttons for the app's AI to choose from, and presses the
// one the AI named. It decides nothing about meaning: no words here. Floors: a layer with a password field, or with several fields (a form in a
// dialog is the task, not a popup), is never offered; only a label that is on the popup is pressed. Guard: worker/test/popup-page.test.js.
export function findPopup(want = null) {
  const visible = node => { const box = node.getBoundingClientRect(); const look = getComputedStyle(node); return box.width > 0 && box.height > 0 && look.visibility !== 'hidden' && look.display !== 'none'; };
  const words = node => (node.innerText || node.value || node.getAttribute('aria-label') || node.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
  const area = node => { const box = node.getBoundingClientRect(); return box.width * box.height; };
  const page = Math.max(1, (window.innerWidth || 1) * (window.innerHeight || 1));
  const ours = node => node.closest('[id^=jobpilotto], [data-jobpilotto]');
  const layered = node => { const look = getComputedStyle(node); return (look.position === 'fixed' || look.position === 'sticky') && Number(look.zIndex) >= 10; };
  // Also inside open shadow roots: a banner drawn by web components (Usercentrics: div#usercentrics-root) is invisible to document.querySelectorAll (Hornbach, 11 Oct 2026). Same walk as fill-flow.js pageSketchOf.
  const deep = selector => { const found = []; const walk = root => { found.push(...root.querySelectorAll(selector)); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot); }; walk(document); return found; };
  const explicit = deep('[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]');
  const floating = deep('*').slice(0, 3000).filter(layered);
  const fields = box => [...box.querySelectorAll('input, select, textarea')].filter(node => !['hidden', 'checkbox', 'radio', 'button', 'submit', 'image'].includes(node.type)).length;
  let boxes = [...new Set([...explicit, ...floating])].filter(node => !ours(node) && visible(node) && area(node) >= page * 0.02
    && !node.querySelector('input[type=password]') && fields(node) <= 1);
  boxes = boxes.filter(node => !boxes.some(other => other !== node && other.contains(node)));   // the outer layer, once
  // A link to another address, or one that opens a new tab, is no dismiss control (jobs.ch, 10 Oct 2026: "Cookie notice" opened a tab per press, each with the same banner): "#", script and same-page links stay.
  const stays = node => { if (node.tagName !== 'A' || !node.getAttribute('href')) return true; if (/^(_blank|_top|_parent)$/i.test(node.getAttribute('target') || '')) return false; try { const to = new URL(node.href, location.href); return to.protocol === 'javascript:' || to.href.split('#')[0] === location.href.split('#')[0]; } catch { return false; } };
  const buttonsOf = box => [...box.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')].filter(node => visible(node) && stays(node) && words(node) && words(node).length < 60);
  const withButtons = boxes.filter(box => buttonsOf(box).length);
  if (want?.list) { const box = withButtons[0]; return box ? {text: words(box).slice(0, 600), buttons: [...new Set(buttonsOf(box).map(words))].slice(0, 20)} : null; }
  if (want?.press) { const button = withButtons.flatMap(buttonsOf).find(node => words(node) === want.press); if (button) button.click(); return button ? words(button) : ''; }
  return null;
}

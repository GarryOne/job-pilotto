// Injected by Playwright MCP before application page scripts. This prevents accidental
// submission while an agent fills a form. It is not an adversarial security boundary:
// arbitrary browser code or a site-specific background request can bypass DOM event hooks.
(() => {
  if (window.__jobPilottoGuardActive) return;
  let active = true;
  Object.defineProperty(window, '__jobPilottoGuardActive', {get: () => active});

  const legal = /(^|\b)(i agree|i accept|terms|privacy|consent|acknowledg|authorize)(\b|$)/i;
  const submit = /(^|\b)(submit|send application|apply now|complete application|finish application)(\b|$)/i;
  const labelOf = el => {
    if (!el) return '';
    const label = el.closest?.('label');
    return [el.getAttribute?.('aria-label'), el.getAttribute?.('name'), el.textContent,
            label?.textContent, ...Array.from(el.labels || [], item => item.textContent), el.id]
      .filter(Boolean).join(' ');
  };
  const isSubmit = el => {
    const button = el?.closest?.('button, input[type="submit"], [role="button"]');
    if (!button) return false;
    return button.type === 'submit' || submit.test(labelOf(button));
  };
  const isLegal = el => {
    const control = el?.closest?.('input[type="checkbox"], label');
    if (!control) return false;
    const input = control.matches?.('label') ? control.control || control.querySelector('input') : control;
    return input?.type === 'checkbox' && legal.test(labelOf(control) + ' ' + labelOf(input));
  };
  const block = event => {
    if (!active) return;
    if (isSubmit(event.target) || isLegal(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener('click', block, true);
  document.addEventListener('submit', event => {
    if (active) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('change', event => {
    if (active && isLegal(event.target) && event.target.checked) event.target.checked = false;
  }, true);
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  HTMLFormElement.prototype.submit = function (...args) {
    if (active) throw new Error('Job Pilotto blocked form submission during agent work');
    return nativeSubmit.apply(this, args);
  };
  if (nativeRequestSubmit) HTMLFormElement.prototype.requestSubmit = function (...args) {
    if (active) throw new Error('Job Pilotto blocked form submission during agent work');
    return nativeRequestSubmit.apply(this, args);
  };

  // A deliberate owner action releases the guard only after the agent hands over the tab.
  document.addEventListener('DOMContentLoaded', () => {
    const box = document.createElement('div');
    box.id = 'job-pilotto-submit-guard';
    box.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#132439;color:white;padding:10px 12px;border-radius:8px;font:13px sans-serif;box-shadow:0 2px 12px #0008';
    const status = document.createElement('span');
    status.textContent = 'Job Pilotto: Submit and legal consent paused. ';
    const release = document.createElement('button');
    release.type = 'button';
    release.textContent = 'Unlock for my review';
    release.style.cssText = 'background:#fff;color:#132439;border:0;border-radius:4px;padding:5px;cursor:pointer';
    release.addEventListener('click', event => {
      event.stopPropagation();
      if (window.confirm('Have you reviewed every field and attachment? Unlock Submit and legal choices for your own action?')) {
        active = false;
        status.textContent = 'Job Pilotto: unlocked for your review. ';
        release.remove();
      }
    });
    box.append(status, release);
    document.documentElement.append(box);
  }, {once: true});
})();

// The form filler's dropdowns (split from page/fill.js, 9 Oct 2026): a menu is armed with its answer and picked when your (or the extension's
// trusted) click opens it (page/menu-pick.js checks the pick took); where the next armed menu and the phone box are, for flow.js clickCombos;
// the phone's country from its prefix. Needs page/fill-labels.js first. Guarded by desktop/e2e/test/menu-pick.test.mjs, fill-categories.test.js.
(() => {
  if (window.__jobPilottoFillMenusLoaded) return;
  window.__jobPilottoFillMenusLoaded = true;
  const {clean, norm, sleep, labelOf, comboControl, comboValue} = window.__jobPilottoFillKit;

  // Phone widgets with a separate country menu: the country comes from the number's prefix (every code: page/dial-codes.js).
  const DIAL = {...(window.__jobPilottoDial || {}), '+1': 'United States', '+30': 'Greece', '+31': 'Netherlands', '+32': 'Belgium', '+33': 'France', '+34': 'Spain',
    '+36': 'Hungary', '+39': 'Italy', '+40': 'Romania', '+41': 'Switzerland', '+43': 'Austria', '+44': 'United Kingdom',
    '+45': 'Denmark', '+46': 'Sweden', '+47': 'Norway', '+48': 'Poland', '+49': 'Germany', '+351': 'Portugal', '+353': 'Ireland',
    '+358': 'Finland', '+373': 'Moldova', '+380': 'Ukraine', '+420': 'Czech Republic', '+421': 'Slovakia', '+972': 'Israel',
    '+971': 'United Arab Emirates', '+91': 'India', '+86': 'China', '+81': 'Japan', '+61': 'Australia', '+55': 'Brazil'};
  const dialOf = phone => Object.keys(DIAL).sort((a, b) => b.length - a.length).find(code => String(phone || '').replace(/\s/g, '').startsWith(code));

  // Searchable dropdowns (react-select on Greenhouse) only open for real user input: scripted clicks and keys are ignored (checked on a live form, 27 Sep 2026). So the extension never opens them; it marks each one, and when you click it, picks the answer in the menu your click opened.
  const OPTION = '[class*="option"], [role="option"]';
  // The innermost option elements of an open menu (not the phone field's hidden country list).
  const optionNodes = () => Array.from(document.querySelectorAll(OPTION))
    .filter(o => o.offsetParent !== null && !o.querySelector(OPTION) && !/iti__/.test(o.className));
  const matchOption = answer => {
    if (String(answer).includes(' || ')) {
      for (const alternative of String(answer).split(' || ')) { const hit = matchOption(alternative); if (hit) return hit; }
      return null;
    }
    const want = norm(answer);
    const options = optionNodes();
    // "Geneva, Switzerland": an option naming every part (Geneva … Switzerland), when only one does.
    const parts = want.split(/\s*,\s*/).filter(Boolean);
    if (parts.length > 1) {
      const all = options.filter(o => parts.every(part => norm(o.textContent).includes(part)));
      if (all.length >= 1) return all[0];
    }
    const exact = options.filter(o => norm(o.textContent) === want);
    if (exact.length === 1) return exact[0];
    const starts = options.filter(o => norm(o.textContent).startsWith(want));
    if (starts.length === 1) return starts[0];
    const contains = options.filter(o => norm(o.textContent).includes(want));
    return contains.length === 1 ? contains[0] : null;
  };

  // Mark a dropdown with its answer; your click opens the menu, and the answer is picked in it.
  const armCombo = (field, answer) => {
    const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
    if (!el) return false;
    const control = comboControl(el); control.__jobPilottoDisarm?.();   // armed again (Use in the app, a re-arm): the earlier answer's click handler goes
    control.style.outline = '3px solid #d9540b';
    control.style.outlineOffset = '2px';
    const badge = document.createElement('div');
    badge.className = 'job-pilotto-badge';
    badge.textContent = `✈️ Click to choose: ${String(answer).split(' || ')[0]}`;
    badge.style.cssText = 'margin-top:4px;font:600 12px system-ui,sans-serif;color:#d9540b';
    control.parentElement.insertBefore(badge, control.nextSibling);
    control.dataset.jobpilottoArmed = labelOf(el) || field;
    const done = () => { control.style.outline = ''; badge.remove(); delete control.dataset.jobpilottoArmed; control.removeEventListener('mousedown', onOpen, true); };
    const onOpen = event => {
      if (!event.isTrusted) return;
      setTimeout(async () => {
        let option = matchOption(answer);
        if (!option) {
          // The menu as it opened (before typing filters it): for the fill-failure report's snapshot (snapshot.js).
          try { (window.__jobPilottoMenuSnapshots ||= {})[control.dataset.jobpilottoArmed] = window.__jobPilottoSnapshot?.({field: el.id || el.name}); } catch {} var shown = []; for (let w = 0; w < 1500 && !shown.length; w += 150) { await sleep(150); shown = optionNodes().map(o => clean(o.textContent)).filter(Boolean).slice(0, 60); } option = matchOption(answer);   // the menu's own choices once drawn (a slow menu: Coop, 8 Oct 2026)
          // Long menus (countries, cities) show only their first entries: type the answer to filter, which the menu accepts once your click has opened it; search-as-you-type fields (Location) load suggestions from the server: type the first part, wait for them.
          if (!option) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(answer).split(' || ')[0].split(',')[0].trim());
          if (!option) el.dispatchEvent(new Event('input', {bubbles: true}));
          for (let waited = 0; waited < 4000 && !option; waited += 250) { await sleep(250); option = matchOption(answer); }
        }
        // Picked only when the page shows it (page/menu-pick.js); what was seen goes to flow.js clickCombos and the fill card's reason (observed, not assumed: 9 Oct 2026).
        const opened = el.getAttribute('aria-expanded') === 'true' || optionNodes().length > 0;   // before the pick closes it
        const took = option ? await (window.__jobPilottoMenuPick?.({el, option, control, readValue: comboValue}) ?? (option.click(), {selectedAfter: true, trusted: false})) : {selectedAfter: false, trusted: false};
        window.__jobPilottoLastPick = {asked: String(answer).split(' || ')[0], got: option ? clean(option.textContent) : '', opened, found: !!option, ...took};
        if (took.selectedAfter) { done(); return; }
        badge.textContent = `✈️ Suggested: ${answer} (pick it yourself)`; if (!option) window.__jobPilottoMenuMissed?.(el, shown);   // page/propose.js: no text left in the box; its choices go to the app
      }, 120);
    };
    control.addEventListener('mousedown', onOpen, true); control.__jobPilottoDisarm = done;
    return true;
  };

  // For "Fill drop-down menus too": the next armed dropdown, scrolled into view, as viewport coordinates
  // for a real click (sent by the extension through Chrome's debugger), or null when none is left.
  window.__jobPilottoNextCombo = async (skip = 0) => {
    const control = Array.from(document.querySelectorAll('[data-jobpilotto-armed]'))[skip];
    if (!control) return null;
    // Instant, not smooth: sites with smooth scrolling (Greenhouse) moved the menu after it was measured.
    control.scrollIntoView({block: 'center', behavior: 'instant'});
    await sleep(120);
    const rect = control.getBoundingClientRect();
    return {x: Math.round(rect.left + Math.min(40, rect.width / 2)), y: Math.round(rect.top + rect.height / 2),
      label: control.dataset.jobpilottoArmed};
  };
  // After the country menu is picked: where to type the national number (the widget adds the prefix).
  window.__jobPilottoPhoneSpot = async () => {
    const phone = window.__jobPilottoPhone;
    const el = phone && (document.getElementById(phone.field) || document.querySelector(`[name="${CSS.escape(phone.field)}"]`));
    if (!el) return null;
    el.scrollIntoView({block: 'center', behavior: 'instant'});
    await sleep(120);
    const rect = el.getBoundingClientRect();
    return {x: Math.round(rect.left + 30), y: Math.round(rect.top + rect.height / 2), text: phone.national};
  };
  window.__jobPilottoArmedCount = () => document.querySelectorAll('[data-jobpilotto-armed]').length;
  Object.assign(window.__jobPilottoFillKit, {DIAL, dialOf, armCombo});
})();

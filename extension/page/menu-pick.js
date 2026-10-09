// Picking a menu's option and checking it took (owner, 9 Oct 2026, Migros on SuccessFactors: a scripted click on the option was ignored by the widget, and
// "a menu picked for you, matched" was logged over an empty field). Runs in the page (main world) before fill.js, which calls __jobPilottoMenuPick from its
// armed-menu handler. A pick counts only when the page shows it: our reader sees a value, the option says selected, or the box shows the option AND the menu
// closed (text typed to filter a long menu, the menu still open, is not a choice). When the widget ignores the scripted click, the option's spot is left in
// __jobPilottoPickSpot for flow.js clickCombos, which clicks it for real through Chrome's debugger; the selection is then waited for and checked again.
// → {selectedAfter, trusted}. Guarded by desktop/e2e/test/menu-pick.test.mjs (three shapes: real click only, plain, never selects).
(() => {
  if (window.__jobPilottoMenuPickLoaded) return;
  window.__jobPilottoMenuPickLoaded = true;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  window.__jobPilottoMenuPick = async ({el, option, control, readValue}) => {
    const selected = () => !!readValue?.(el) || (option.isConnected && option.getAttribute('aria-selected') === 'true') ||
      (norm(el.value) === norm(option.textContent) && el.getAttribute('aria-expanded') !== 'true');
    option.click();
    await sleep(200);
    if (selected()) return {selectedAfter: true, trusted: false};
    option.scrollIntoView({block: 'nearest'});
    const spot = option.getBoundingClientRect();
    window.__jobPilottoPickSpot = {x: Math.round(spot.left + Math.min(30, spot.width / 2)), y: Math.round(spot.top + spot.height / 2), label: control?.dataset.jobpilottoArmed || ''};
    for (let waited = 0; waited < 4000; waited += 150) {
      await sleep(150);
      if (selected()) { window.__jobPilottoPickSpot = null; return {selectedAfter: true, trusted: true}; }
    }
    window.__jobPilottoPickSpot = null;
    return {selectedAfter: false, trusted: true};
  };
})();

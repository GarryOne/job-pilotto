// Attaching a PDF to a form: into the file input whose surroundings match a pattern, or, on forms that draw an "Upload a CV" box with a
// + button and create the input only when it is clicked (SuccessFactors, e.g. Coop), by opening that slot first. Loaded in the page before
// fill.js (PAGE_FILES in extension/flow.js). Guarded by desktop/e2e/test/upload-slot.test.mjs (fixture; JP_LIVE=1 on the real Coop form).
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  // Some forms (SuccessFactors) draw an "Upload a CV" box with a + button and create the file input only when it is clicked, in a popup.
  // So when no file input matches, click the + of the slot whose label matches `pattern`, wait for the input that appears, and use it.
  const revealFileInput = async (pattern, skip) => {
    const labels = Array.from(document.querySelectorAll('body *')).filter(el => !el.children.length && visible(el) && (el.textContent || '').length < 80 &&
      pattern.test(el.textContent) && !(skip && skip.test(el.textContent)));
    for (const label of labels) {
      let box = label;
      for (let i = 0; i < 5 && box.parentElement; i++) {
        box = box.parentElement;
        const buttons = Array.from(box.querySelectorAll('[role=button], button')).filter(visible);
        if (!buttons.length) continue;
        const before = new Set(document.querySelectorAll('input[type=file]'));
        buttons[buttons.length - 1].click();
        for (let tries = 0; tries < 10; tries++) {
          await sleep(150);
          const fresh = Array.from(document.querySelectorAll('input[type=file]')).find(el => !before.has(el));
          if (fresh) return fresh;
        }
        break;
      }
    }
    return null;
  };
  // Put a PDF into the file input whose surroundings match `pattern` (a lone file input takes it when `alone`).
  const attachFile = async (file, pattern, alone, skip = null) => {
    const inputs = Array.from(document.querySelectorAll('input[type=file]'));
    const context = el => `${el.id} ${el.name} ${el.getAttribute('aria-label') || ''} ${el.closest('div, fieldset, section')?.textContent || ''}`;
    let input = inputs.find(el => pattern.test(context(el)) && !(skip && skip.test(`${el.id} ${el.name} ${el.getAttribute('aria-label') || ''}`)))
      || (alone && inputs.length === 1 ? inputs[0] : null);
    const revealed = !input;
    if (!input) input = await revealFileInput(pattern, skip);
    if (!input) return false;
    // A file the person chose stays. One this extension attached earlier is replaced by a different one (a CV tailored after the first fill).
    const ours = input.dataset.jobPilottoFile;
    if (input.files?.length && !(ours && input.files[0].name === ours && ours !== file.name)) return false;
    const bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file.name, {type: file.type || 'application/pdf'}));
    input.files = transfer.files;
    input.dataset.jobPilottoFile = file.name;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    if (revealed) { await sleep(800); document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); }
    return true;
  };
  window.__jobPilottoUpload = {attachFile, revealFileInput};
})();

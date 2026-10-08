// The upload operator: puts a file (the CV, a cover letter) into an upload slot, however the page draws it. A slot is found by structure
// (page/skeleton.js uploadSlots: a native file input, visible or hidden behind a styled label, or a pressable that creates the input when
// pressed, as SuccessFactors does). What a slot asks for is a meaning, not a word list here: the service's phrases first, then the floor of
// words everyone knows (extension/alias-schema.js fileKind, copied below as a plain script and kept in step by a test); a wording neither
// knows is left empty and reported so the pack can learn it. The result is verified by re-reading the page, and the slot's fingerprint
// lets the recipe library (extension/recipe-schema.js, operator "upload", param "trigger") say what opens a slot this code cannot.
// It never presses anything that looks like a submit control. Loaded in the page before fill.js (PAGE_FILES in extension/flow.js); guarded by
// desktop/e2e/test/upload-slot.test.mjs (the shapes of slots; JP_LIVE=1 also the real Coop form) and worker/test/upload.test.js.
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  const FILE_KEYS = ['resume', 'cover_letter'];
  const FILE_FLOOR = {
    resume: /\b(resume|r[ée]sum[ée]|cv|c\.v\.|curriculum|lebenslauf)\b/i,
    cover_letter: /\b(cover\s*letter|motivation\s*letter|anschreiben|bewerbungsschreiben|lettre\s+de\s+motivation|lettera\s+di\s+(presentazione|motivazione)|carta\s+de\s+presentaci[oó]n|carta\s+de\s+apresenta[cç][aã]o)\b/i,
  };
  // The same cleaning as cleanLabel in alias-schema.js, for a phrase the pack holds.
  const cleanLabel = label => String(label ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\*+/g, '').replace(/\((optional|required|erforderlich|obligatoire)\)/g, '')
    .replace(/^\s*\d+[.)]\s+/, '').replace(/[\s:;,.?!-]+$/g, '').trim();
  function fileKind(label, aliases) {
    const text = cleanLabel(label);
    if (!text) return '';
    for (const item of Array.isArray(aliases) ? aliases : []) {
      if (!item || !FILE_KEYS.includes(item.key) || !item.phrase) continue;
      if (text === item.phrase || ` ${text} `.includes(` ${item.phrase} `)) return item.key;
    }
    const found = FILE_KEYS.filter(key => FILE_FLOOR[key].test(text));
    return found.length === 1 ? found[0] : '';
  }

  const kit = () => window.__jobPilottoSkeleton;
  const fingerprintOf = el => { try { return kit() ? kit().fingerprint(kit().skeleton(el)) : ''; } catch { return ''; } };
  const textOf = el => el.innerText ?? el.textContent ?? '';   // innerText is the words a person sees; a DOM without layout has only textContent
  const NAMED = /\S+\.(pdf|docx?|rtf|txt|odt)\b/i;

  // The slots on the page, each with what it asks for (title), whether the page marks it required, whether it holds a file now.
  function slots(doc = document) {
    if (!kit()?.uploadSlots) return [];
    return kit().uploadSlots(doc, visible).map(slot => {
      const start = slot.input || slot.trigger;
      let child = start;
      while (child.parentElement && child.parentElement !== slot.el) child = child.parentElement;
      // The title is the field's text outside the widget itself; a widget alone in its field has only its own words.
      const title = clean(Array.from(slot.el.children).filter(el => el !== child).map(textOf).join(' ')) || clean(textOf(slot.el));
      const hints = slot.input ? `${slot.input.getAttribute('aria-label') || ''} ${slot.input.name || ''} ${slot.input.id || ''}` : '';
      const holds = !!(slot.input?.files?.length) || !!slot.el.dataset.jobpilottoFile || NAMED.test(textOf(slot.el));
      return {...slot, title: title.slice(0, 160), hints, fp: fingerprintOf(slot.el), filled: holds,
        required: /\*/.test(title) || !!slot.input?.required || slot.input?.getAttribute('aria-required') === 'true' || slot.trigger?.getAttribute('aria-required') === 'true'};
    });
  }
  // What a slot asks for, from its title (then the input's own aria-label/name): 'resume', 'cover_letter' or ''.
  const meaningOf = (slot, aliases) => fileKind(slot.title, aliases) || fileKind(slot.hints, aliases);

  // The rows the form audit lists for uploads: the CV slot keeps the field name "resume" (what the panel and the session page know).
  function rows(doc = document, aliases = window.__jobPilottoAliases || []) {
    const all = slots(doc);
    return all.map((slot, i) => {
      const meaning = meaningOf(slot, aliases) || (all.length === 1 ? 'resume' : '');
      return {field: meaning || `upload_${i + 1}`, label: slot.title || 'Upload', type: 'file', required: slot.required, legal: false, filled: slot.filled};
    });
  }

  // Press the slot's trigger (or the one a recipe names) and wait for the file input the page creates.
  async function reveal(slot, params = {}) {
    let trigger = slot.trigger;
    if (params.trigger) { try { trigger = slot.el.querySelector(params.trigger) || trigger; } catch { /* a recipe's selector is data: ignore a bad one */ } }
    if (!trigger || trigger.type === 'submit') return null;
    const before = new Set(document.querySelectorAll('input[type=file]'));
    trigger.click();
    for (let tries = 0; tries < 10; tries++) {
      await sleep(150);
      const fresh = Array.from(document.querySelectorAll('input[type=file]')).find(el => !before.has(el));
      if (fresh) return fresh;
    }
    return null;
  }

  // Put the file into the input, tell the page, and check the page took it: the input still holds it, or the page consumed the input, or the
  // slot visibly changed. A file the person chose stays; one this extension attached earlier is replaced by a different file (a CV tailored later).
  async function attach(slot, input, file, revealed) {
    const ours = input.dataset.jobPilottoFile;
    if (input.files?.length && !(ours && input.files[0].name === ours && ours !== file.name)) return {ok: true, why: 'already holds a file'};
    const before = slot.el.outerHTML.length;
    const bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file.name, {type: file.type || 'application/pdf'}));
    input.files = transfer.files;
    input.dataset.jobPilottoFile = file.name;
    slot.el.dataset.jobpilottoFile = file.name;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    await sleep(revealed ? 800 : 150);
    if (revealed) document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    const kept = input.isConnected ? input.files?.[0]?.name === file.name : true;
    const changed = slot.el.outerHTML.length !== before || !input.isConnected;
    return kept && (changed || !revealed) ? {ok: true} : {ok: false, why: kept ? 'the page did not show the file' : 'the page cleared the file'};
  }

  // files: {resume, coverLetter} (each {data: base64, name, type} or absent). -> one result per slot:
  // {meaning, fp, recipe, ok, why, label} where ok is true/false only when the slot was operated (a failure is a miss to report);
  // a slot with no file for it, or with a wording nobody knows, is {ok: undefined, why} and is never touched.
  async function fill(files, {aliases = window.__jobPilottoAliases || [], recipes = window.__jobPilottoRecipes || {}, doc = document} = {}) {
    const all = slots(doc);
    const results = [];
    for (const slot of all) {
      // A lone slot with a wording nobody knows takes the CV, as a lone file input always did.
      const meaning = meaningOf(slot, aliases) || (all.length === 1 ? 'resume' : '');
      const label = cleanLabel(slot.title).slice(0, 60);
      const recipe = recipes[slot.fp]?.operator === 'upload' ? recipes[slot.fp] : null;
      const base = {meaning, fp: slot.fp, recipe: recipe ? recipe.version : 0, label};
      const file = meaning === 'resume' ? files.resume : meaning === 'cover_letter' ? files.coverLetter : null;
      if (!meaning) { results.push({...base, why: 'wording unknown'}); continue; }
      if (!file?.data) { results.push({...base, why: 'no file for it'}); continue; }
      try {
        const revealed = !slot.input;
        const input = slot.input || await reveal(slot, recipe?.params || {});
        if (!input) { results.push({...base, ok: false, why: 'no file input appeared'}); continue; }
        results.push({...base, ...await attach(slot, input, file, revealed)});
      } catch (error) { results.push({...base, ok: false, why: String(error.message || error).slice(0, 80)}); }
    }
    return results;
  }

  // The fingerprints of the slots here: what the app is asked recipes for.
  const fingerprints = (doc = document) => [...new Set(slots(doc).map(slot => slot.fp).filter(Boolean))];

  const api = {slots, rows, fill, fingerprints, fileKind, meaningOf};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobPilottoUpload = api;
})();

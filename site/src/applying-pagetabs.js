// /admin/lab-form-filling's page tabs (owner, 14 Oct 2026: "about 5-6-7 tables/sections on this page, too much to scroll, put them under tabs"): one tab bar under the tiles,
// one panel per tab, every section drawn into a panel. The bar reuses the Fixed tab's .tabs look and its #hash links (applying-fixed.js): #needs-fix, #fixed and #by-cause
// open the To fix tab, whose own tabs then pick the list ("tabs in tabs", accepted by the owner for now). Owns PAGETABS_CSS and PAGETABS_SCRIPT, the client code that sits
// right after the tiles inside the page's fetch callback (needs el, app, d). Plain quotes only: it sits in a template literal. Guard: test/applying-pagetabs.test.js.

// Six tabs, each one question (owner, 15 Oct 2026): To fix (what is broken), Fixed (did the fixes hold), Sites (where each site stands), Outcomes (how applications end), Replays, Coverage.
// The page opens on To fix, whose own sub-tabs pick Needs a fix / By cause / Why fields were left empty. Old links keep working: HASH_TAB maps them.
export const PAGE_TABS = [['tofix', 'To fix'], ['fixed', 'Fixed'], ['sites', 'Sites'], ['outcomes', 'Outcomes'], ['replays', 'Replays'], ['coverage', 'Coverage']];
export const FIX_HASHES = ['#needs-fix', '#by-cause', '#left-empty'];   // the To fix sub-tabs
export const HASH_TAB = {'#resolution': 'outcomes', '#pool': 'sites', '#fixes': 'tofix', '#needs-fix': 'tofix', '#by-cause': 'tofix', '#left-empty': 'tofix'};

// The page bar is an underline nav (owner, 14 Oct 2026: the two bars should not look the same); the Fixes tab's own folder tabs keep their look, attached to their panel.
export const PAGETABS_CSS = `.tabs.pagetabs{gap:2px;margin:22px 0 0;padding:0}.tabs.pagetabs a{border:0;border-radius:0;background:none;padding:10px 16px 12px;font-size:15px}
.tabs.pagetabs a.on{background:none;border:0;box-shadow:inset 0 -3px 0 var(--amber);color:var(--text);font-weight:600}.panel[hidden]{display:none}.panel>section:first-child,.panel>details:first-child{margin-top:18px;padding-top:0;border-top:0}`;

export const PAGETABS_SCRIPT = `
  const PAGE_TABS = ${JSON.stringify(PAGE_TABS)}, FIX_HASHES = ${JSON.stringify(FIX_HASHES)}, HASH_TAB = ${JSON.stringify(HASH_TAB)};
  const pageTabs = el('nav', {className: 'tabs pagetabs', role: 'tablist', 'aria-label': 'Applying sections'}), panels = Object.fromEntries(PAGE_TABS.map(([id]) => [id, el('div', {className: 'panel', role: 'tabpanel'})]));
  app.append(pageTabs, ...Object.values(panels));
  let fixHash = '#needs-fix';   // the To fix tab reopens the list last shown in it
  const showPage = () => { const hash = typeof location !== 'undefined' ? location.hash : ''; if (FIX_HASHES.includes(hash)) fixHash = hash;
    const which = HASH_TAB[hash] || (panels[hash.slice(1)] ? hash.slice(1) : PAGE_TABS[0][0]);
    for (const [id, box] of Object.entries(panels)) box.hidden = id !== which;
    pageTabs.textContent = ''; pageTabs.append(...PAGE_TABS.map(([id, name]) => el('a', {href: id === 'tofix' ? fixHash : '#' + id, role: 'tab', 'aria-selected': String(id === which), className: id === which ? 'on' : '',
      textContent: id === 'sites' && d.pool.length ? name + ' · ' + d.pool.length : name}))); };
  showPage();
  if (typeof window !== 'undefined') window.addEventListener('hashchange', showPage);
`;

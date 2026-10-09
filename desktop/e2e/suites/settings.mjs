/* global document, window */
// Settings: every section, with each AI engine chosen. Starts from a set-up install (a key saved, a workspace connected).
import {finish, snap} from '../lib/layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {FIXTURES} from '../lib/cvfixtures.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {step as wizardStep} from '../lib/app.mjs';
import crypto from 'node:crypto';
import os from 'node:os';

// What a step needs from an earlier one when E2E_STEPS picks it (lib/runner.mjs wantedWords).
export const stepNeeds = {'AI engine panel': ['every Settings section renders']};
export const name = 'settings';
// One failed step never hides the rest: the runner records it and goes on (lib/runner.mjs); only the setup steps marked `critical` stop the suite.
export const keepGoing = true;
const SECTIONS = ['overview', 'profile', 'automation', 'connections', 'data', 'appearance', 'license', 'advanced'];

export async function run(ctx) {
  const {page, app} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  await ctx.run('every Settings section renders', async () => {
    await page.click('.nav[data-view="settings"]:not([data-settings="profile"])');
    for (const section of SECTIONS) {
      await page.click(`[data-settings-go="${section}"]`);
      await snap(ctx, `settings-${section}`, {view: 'settings'});
    }
  }, {needs: ctx.needs});
  await ctx.run('the AI engine panel is coherent with each engine chosen (a key is saved in both)', async () => {
    // This step goes from the API key to Claude Code and back. A Mac is seeded on Claude Code (lib/seed.mjs): start from the API key, as CI does.
    if (ctx.engine === 'cli') {
      await page.evaluate(async () => { await window.pilot.setAiEngine('api'); await window.pilot.saveSettings({claudeCodeNotice: false}); });   // the seed accepted the one-time notice
      await page.reload();
      await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    }
    await page.click('[data-settings-go="connections"]');
    // The engine panel opens from its service row's Manage button (the "AI" row: "Claude or OpenAI: …"), as it does for a person.
    await page.locator('#conn-on .service-card, #conn-off .service-card').filter({hasText: 'Claude or OpenAI'}).first().getByRole('button').click();
    await page.locator('#ai-engine-settings [data-choice="cli"]').waitFor({state: 'visible', timeout: 15000});
    // Choosing Claude Code asks first (a notice whose confirm button carries data-notice="yes"); the engine only switches on the confirm. Then back to the API key, which switches at once.
    // A CI runner has no Claude Code (6 Oct 2026, the first real CI run of this suite): there the app must refuse the switch and say why; on a Mac with it, switch.
    const installed = (await page.evaluate(() => window.pilot.claudeCodeStatus()))?.installed;
    await page.locator('#ai-engine-settings [data-choice="cli"]').click();
    if (!installed) {
      await page.locator('[data-notice="yes"]').click().catch(() => {});   // the confirm may not be offered at all without it
      await page.waitForFunction(() => /not installed/i.test(document.getElementById('ai-engine-settings')?.textContent || ''), null, {timeout: 15000})
        .catch(() => { throw new Error('without Claude Code the panel does not say it is not installed'); });
      if (await page.evaluate(() => document.querySelector('#ai-engine-settings [data-choice="cli"]')?.getAttribute('aria-checked')) === 'true') throw new Error('the app switched to Claude Code although it is not installed');
      await snap(ctx, 'settings-engine-cli-missing', {view: 'settings', situation: 'Claude Code CLI chosen on a computer where it is not installed: the API key stays the engine'});
      return;
    }
    await page.locator('[data-notice="yes"]').click();
    await page.waitForFunction(() => document.querySelector('#ai-engine-settings [data-choice="cli"]')?.getAttribute('aria-checked') === 'true', null, {timeout: 15000});
    await page.waitForTimeout(800);
    await snap(ctx, 'settings-engine-cli-chosen', {view: 'settings', situation: 'Claude Code CLI is the chosen engine, and an Anthropic API key is saved'});
    await page.locator('#ai-engine-settings [data-choice="api"]').click();
    await page.waitForFunction(() => document.querySelector('#ai-engine-settings [data-choice="api"]')?.getAttribute('aria-checked') === 'true', null, {timeout: 15000});
    await page.waitForTimeout(800);
    await snap(ctx, 'settings-engine-api-chosen', {view: 'settings', situation: 'The Anthropic API key is the chosen engine'});
  }, {needs: ctx.needs});
  await ctx.run('the CV check reads real PDFs: a plain CV passes, each known problem is found, a picture of a CV fails', async () => {
    const target = path.join(ctx.profile, 'cv.pdf'), original = fs.existsSync(target) ? fs.readFileSync(target) : null;
    try {
      for (const [name, fixture] of Object.entries(FIXTURES)) {
        // Printed by the app's own Chromium, then read by the app's own PDF reader (the same path a person's CV takes).
        const pdf = await app.evaluate(async ({BrowserWindow}, html) => {
          const win = new BrowserWindow({show: false, width: 794, height: 1123});
          await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          const data = await win.webContents.printToPDF({pageSize: 'A4', printBackground: true, preferCSSPageSize: true});
          win.destroy();
          return data.toString('base64');
        }, fixture.html);
        fs.writeFileSync(target, Buffer.from(pdf, 'base64'));
        const result = await page.evaluate(() => window.pilot.cvCheckRun());
        if (!result.ok) throw new Error(`${name}: the CV check did not run: ${result.error}`);
        const byId = Object.fromEntries(result.ats.checks.map(item => [item.id, item.status]));
        const wrong = [...fixture.pass.filter(id => byId[id] !== 'pass').map(id => `${id} should pass but is ${byId[id]}`), ...fixture.fail.filter(id => byId[id] === 'pass').map(id => `${id} should be flagged`)];
        if (wrong.length) throw new Error(`${name} (score ${result.ats.score}): ${wrong.join('; ')}`);
        console.log(`  ${name}: score ${result.ats.score}, flagged ${result.ats.checks.filter(item => item.status !== 'pass').map(item => item.id).join(', ') || 'nothing'}`);
      }
    } finally { if (original) fs.writeFileSync(target, original); }
  }, {needs: ctx.needs});
  // ⌘K (6 Oct 2026: the palette had no end-to-end step). Every page is listed, Enter on a typed command opens it, Esc closes. Only "Open <page>" commands are
  // run here: an Actions command starts its task at once (a paid run).
  await ctx.run('⌘K opens the palette: every page is listed, a typed command opens its page, Esc closes it', async () => {
    const pages = await page.evaluate(() => [...new Map([...document.querySelectorAll('.nav[data-view]')].map(nav => [nav.dataset.view, (nav.getAttribute('aria-label') || nav.title || nav.textContent).trim()])).entries()]);
    if (pages.length < 5) throw new Error(`only ${pages.length} pages in the sidebar: this step would test little`);
    await page.click('.nav[data-view="focus"]');
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#palette[open]').waitFor({timeout: 5000}).catch(() => { throw new Error('⌘K did not open the palette'); });
    const listed = await page.locator('#palette-list [role="option"]').allInnerTexts();
    const opens = listed.filter(text => /^Open /.test(text.trim())).length;
    if (opens < new Set(pages.map(([view]) => view)).size) throw new Error(`the palette lists ${opens} "Open …" commands for ${pages.length} pages: ${listed.slice(0, 12).join(' | ')}`);
    // Settings, the whole class: every page, every section heading, and Export/Import data (6 Oct 2026: Export and Import were not in ⌘K).
    const wanted = await page.evaluate(() => [
      ...[...new Map([...document.querySelectorAll('[data-settings-go]')].reverse().map(go => [go.dataset.settingsGo, go.textContent.replace(/\s+/g, ' ').trim()])).values()].map(name => `Open Settings: ${name}`),   // one a page: its first button
      ...[...document.querySelectorAll('[data-settings-page] .setting[id]')].filter(section => !section.closest('[hidden]:not(.view):not([data-settings-page])'))
        .map(section => (section.querySelector('h3') || section.querySelector('h4, summary'))?.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
      'Move your data: Export data', 'Move your data: Import data']);
    const text = listed.map(item => item.replace(/\s+/g, ' '));
    const absent = wanted.filter(label => !text.some(item => item.includes(label)));
    if (absent.length) throw new Error(`not in ⌘K: ${absent.join(' | ')}`);
    await page.keyboard.press('Escape');
    await page.locator('#palette[open]').waitFor({state: 'detached', timeout: 5000}).catch(async () => {
      if (await page.locator('#palette[open]').count()) throw new Error('Esc did not close the palette');
    });
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#palette[open] input').fill('open interviews');
    await page.keyboard.press('Enter');
    await page.locator('.view[data-view="interviews"]:not([hidden])').waitFor({timeout: 5000}).catch(() => { throw new Error('Enter on "open interviews" did not open the Interviews page'); });
    if (await page.locator('#palette[open]').count()) throw new Error('the palette stayed open after running a command');
  }, {needs: ctx.needs});
  await ctx.run('Settings render without layout problems', async () => { finish(ctx); }, {needs: ctx.needs});
  // Last: it restarts the app twice (the steps above hold the first window).
  await ctx.run('Your data: export with keys, reset, then import from the setup brings this computer back as it was', () => roundTrip(ctx), {needs: ctx.needs});
}

// Export -> reset (kept as a backup) -> the app opens at the setup -> "Import an export…" on its Welcome -> restart: the user's files come back
// byte for byte, the keys and the set-up state too (6 Oct 2026: the export left out profile.md and answers.md, and Import was only in Settings,
// out of reach at the setup). Native dialogs are stood in for, and so is the app's own relaunch: the suite starts it again on the same folder.
async function roundTrip(ctx) {
  const file = path.join(os.tmpdir(), `jp-e2e-export-${process.pid}-${Date.now()}.tar.gz`);
  const at = name => path.join(ctx.profile, name);
  const digest = name => fs.existsSync(at(name)) ? crypto.createHash('sha256').update(fs.readFileSync(at(name))).digest('hex') : null;
  // What a person who has not connected Notion yet keeps only here (the wizard's "Notion later"): written if this install has none.
  for (const name of ['profile.md', 'answers.md']) if (!fs.existsSync(at(name))) fs.writeFileSync(at(name), `# e2e ${name}\nkept across an export\n`);
  const FILES = ['profile.md', 'answers.md', 'cv.pdf'];
  const before = {files: Object.fromEntries(FILES.map(name => [name, digest(name)])), ...await ctx.page.evaluate(async () => {
    const state = await window.pilot.state();
    return {secrets: state.secrets, notionIds: state.settings.notionIds || null, jobs: (await window.pilot.jobs())?.total ?? null};
  })};
  if (!Object.values(before.secrets).some(Boolean)) throw new Error('the set-up install has no key saved: nothing to prove about keys');
  const standIn = () => ctx.app.evaluate(({app, dialog}, filePath) => {
    dialog.showSaveDialog = async () => ({canceled: false, filePath});
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filePath]});
    dialog.showMessageBoxSync = () => 1;   // "Reset and restart" / "Import and restart"
    app.relaunch = () => {};               // the suite starts the app again itself, so it keeps hold of it
  }, file);

  await standIn();
  const page = ctx.page;
  await page.click('.nav[data-view="settings"]:not([data-settings="profile"])');
  await page.click('[data-settings-go="data"]');
  await page.click('#setting-data details.troubleshoot summary');   // "Export options", folded
  await page.locator('#export-keys').check();
  await page.click('#export-data');
  await page.waitForFunction(() => /Exported ✓/.test(document.getElementById('data-message')?.textContent || ''), null, {timeout: 60000})
    .catch(async () => { throw new Error(`the export did not finish: "${await page.locator('#data-message').textContent().catch(() => '')}"`); });
  if (!fs.existsSync(file)) throw new Error('Export said done but wrote no file');

  await page.click('[data-settings-go="advanced"]');   // the danger zone is on Advanced
  await page.click('#reset-review');
  if (!(await page.locator('#reset-backup').isChecked())) throw new Error('a reset does not keep a backup by default');
  await page.fill('#reset-confirm', 'RESET');
  await page.click('#reset-go').catch(() => {});   // the app exits under the click
  await ctx.relaunch();
  await ctx.page.waitForSelector('.step[data-step="welcome"]', {state: 'visible', timeout: 60000})
    .catch(async () => { throw new Error(`after a reset the app should open at the setup, it shows "${await wizardStep(ctx.page)}"`); });
  if (fs.existsSync(at('profile.md'))) throw new Error('the reset left profile.md in place: the round trip would prove nothing');

  await standIn();
  await ctx.page.click('#welcome-import').catch(() => {});   // the app exits under the click
  await ctx.relaunch();
  // page.evaluate, not waitForFunction: an async predicate returns a Promise, which counts as true at once.
  let setUp = false;
  for (let i = 0; i < 60 && !setUp; i++) setUp = await ctx.page.evaluate(async () => (await window.pilot.state()).settings.setupDone === true) || (await ctx.page.waitForTimeout(1000), false);
  if (!setUp) throw new Error(`after the import the app is not set up again (${JSON.stringify(await ctx.page.evaluate(() => window.pilot.lastReset()))})`);
  const after = {files: Object.fromEntries(FILES.map(name => [name, digest(name)])), ...await ctx.page.evaluate(async () => {
    const state = await window.pilot.state();
    return {secrets: state.secrets, notionIds: state.settings.notionIds || null, jobs: (await window.pilot.jobs())?.total ?? null};
  })};
  // Field by field, so a failure names what changed (a whole object is cut off in the report).
  const differ = [];
  // Keys: none lost. One the app makes at start when missing (the extension's token) may appear.
  for (const name of Object.keys(before.secrets)) if (before.secrets[name] && !after.secrets?.[name]) differ.push(`key ${name} lost`);
  for (const key of ['files', 'notionIds']) for (const name of new Set([...Object.keys(before[key] || {}), ...Object.keys(after[key] || {})]))
    if (JSON.stringify(before[key]?.[name]) !== JSON.stringify(after[key]?.[name])) differ.push(`${key}.${name} ${JSON.stringify(before[key]?.[name])} -> ${JSON.stringify(after[key]?.[name])}`);
  if (before.jobs !== after.jobs) differ.push(`jobs ${before.jobs} -> ${after.jobs}`);
  if (differ.length) throw new Error(`not as before the export: ${differ.join('; ')}`);
  fs.rmSync(file, {force: true});
}

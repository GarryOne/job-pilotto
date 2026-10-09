/* global document */
// What the storemove suite (suites/storemove.mjs) reads and drives: the seeded data's items on every screen, Settings → Your data, the native dialogs
// export and import open (Playwright cannot press an OS window), the move's own Python process (killed halfway), and what the Notion stand-in holds.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openPanel, panelRows} from './activity-steps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The seeded jobs and the match (lib/store_seed.py): every screen is read for these names only, so the app's own rows (a hint, an empty state) never count.
export const COMPANIES = ['Kestrel Labs', 'Huxley Systems', 'Marlow Freight', 'Orrin AG'];
export const TEXTS = {
  profile: '# Profile\n\nE2E storemove: a platform engineer in Zurich, on call for ten years.\n',
  answers: '# Standard answers\n\n- Notice period: three months (e2e storemove)\n',
  knowledge: '# Form knowledge\n\n- Workday forms ask for the notice period in weeks (e2e storemove)\n',
};
export const NOTION_PROFILE = 'E2E storemove: the Profile this Notion already had.';

// The app's store gets the seed through the engine's own store code, in this app's data folder (the script refuses any other).
export function seedStore(profile) {
  for (const [name, text] of Object.entries(TEXTS)) fs.writeFileSync(path.join(profile, `${name}.md`), text);
  const out = execFileSync('python3', [path.join(HERE, 'store_seed.py'), path.join(profile, 'data')], {encoding: 'utf8'});
  return JSON.parse(out.trim().split('\n').pop());
}

const settled = (page, ms = 600) => page.waitForTimeout(ms);
async function named(page, selector, {timeout = 30000, want = 1} = {}) {
  // Rows arrive once the store answered: wait for `want` of the seeded names, then read them all.
  await page.waitForFunction(({selector, names, want}) => [...document.querySelectorAll(selector)].map(node => node.textContent).join('\n')
    .split('\n').filter(Boolean).length && names.filter(name => [...document.querySelectorAll(selector)].some(node => node.textContent.includes(name))).length >= want,
  {selector, names: COMPANIES, want}, {timeout}).catch(() => {});
  return page.evaluate(({selector, names}) => names.filter(name => [...document.querySelectorAll(selector)].some(node => node.textContent.includes(name))), {selector, names: COMPANIES});
}

// {jobs, focus, interviews, activity}: which seeded items each screen shows. Compared before and after a move or an import.
export async function screens(page) {
  const go = async view => { await page.click(`.nav[data-view="${view}"]`); await page.waitForSelector(`.view[data-view="${view}"]:not([hidden])`); await settled(page); };
  await go('jobs');
  await page.selectOption('#filter-status', 'all');   // the default shows new matches only; the applications are under All
  const jobs = await named(page, 'article.job-row', {want: 4});
  await go('focus');
  const focus = await named(page, '#focus-list .focus-item', {timeout: 8000});
  await go('interviews');
  // An interview's row also lists every job (its job picker): read the row's own title, not the names.
  await page.waitForFunction(() => [...document.querySelectorAll('#iv-saved tr[data-id]')].some(row => /first round/i.test(row.textContent)), null, {timeout: 30000}).catch(() => {});
  const interviews = await page.evaluate(() => [...document.querySelectorAll('#iv-saved tr[data-id]')].filter(row => /first round/i.test(row.textContent)).map(() => 'Huxley Systems: first round'));
  if (!interviews.length) console.log(`  interview rows: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#iv-saved tr[data-id]')].map(row => row.innerText.replace(/\s+/g, ' ').slice(0, 160))))}`);
  await openPanel({page});
  await page.waitForFunction(() => [...document.querySelectorAll('#activity-recent .recent-row')].some(row => /4 emails/.test(row.textContent)), null, {timeout: 30000}).catch(() => {});
  const activity = (await panelRows(page)).filter(row => /Checked 4 emails|4 emails/.test(row.what)).map(row => row.what);
  await page.keyboard.press('Escape');
  return {jobs, focus, interviews, activity};
}
export function sameScreens(before, after) {
  const differ = Object.keys(before).filter(key => JSON.stringify([...before[key]].sort()) !== JSON.stringify([...after[key]].sort()));
  if (differ.length) throw new Error(`the screens differ: ${differ.map(key => `${key} was ${JSON.stringify(before[key])}, now ${JSON.stringify(after[key])}`).join('; ')}`);
}

export async function yourData(page) {
  await page.click('.nav[data-view="settings"]');
  await page.click('[data-settings-go="data"]');
  await page.waitForSelector('#export-data', {state: 'visible', timeout: 10000});
}
export const storeMessage = page => page.evaluate(() => document.getElementById('store-message')?.textContent.trim() || '');
export const settingsOf = profile => JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));

// The native dialogs, answered for the person: the next save dialog picks `file`, an "Import and restart?" question answers its second button, and a
// restart only exits (the suite starts the app again on the same folder, as a person's next start would).
export const answerSave = (app, file) => app.evaluate(({dialog}, filePath) => { dialog.showSaveDialog = async () => ({canceled: false, filePath}); }, file);
export const answerImport = (app, file) => app.evaluate(({app: electron, dialog}, filePath) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filePath]});
  dialog.showMessageBoxSync = () => 1;
  electron.relaunch = () => {};
}, file);

// The move's Python process (python -m src.stores.copy), found among this app's own descendants only (the engine may start under a wrapper):
// never a pattern kill, other sessions run copies too.
export function copyProcess(appPid) {
  const rows = execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], {encoding: 'utf8'}).split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, command]) => ({pid: Number(pid), ppid: Number(ppid), command}));
  const mine = new Set([appPid]);
  for (let grew = true; grew;) { grew = false; for (const row of rows) if (mine.has(row.ppid) && !mine.has(row.pid)) { mine.add(row.pid); grew = true; } }
  return rows.filter(row => row.pid !== appPid && mine.has(row.pid) && /-m src\.stores\.copy\b/.test(row.command)).map(row => row.pid);
}
// A second install's own log (its profile's logs/app.log), the lines about data and restarts: evidence when its import does not go as planned.
export const logLines = (profile, pattern = /\[(data|window|store)\]|import/i) => {
  try { return fs.readFileSync(path.join(profile, 'logs', 'app.log'), 'utf8').split('\n').filter(line => pattern.test(line)).slice(-12); } catch { return []; }
};
export const journalOf = profile => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'data', 'move-sqlite-to-notion.json'), 'utf8')); } catch { return {}; } };

// What the stand-in holds: rows per database (by a word of its title), file blocks, and a page's text.
export const rowsIn = (standIn, word) => standIn.dump().filter(item => item.object === 'database' && item.title.includes(word)).reduce((sum, db) => sum + db.rows, 0);
export const fileBlocks = standIn => [...standIn.objects.values()].filter(item => item.object === 'block' && ['file', 'image', 'pdf'].includes(item.type) && !item.archived).length;
export function pageText(standIn, pageId) {
  const {body} = standIn.handle('GET', `blocks/${pageId}/children`, {}, new URLSearchParams());
  return (body.results || []).map(block => (block[block.type]?.rich_text || []).map(part => part.plain_text || part.text?.content || '').join('')).join('\n');
}
export function writeProfile(standIn, pageId, text) {
  const {status} = standIn.handle('PATCH', `blocks/${pageId}/children`, {children: [{object: 'block', type: 'paragraph', paragraph: {rich_text: [{type: 'text', text: {content: text}}]}}]}, new URLSearchParams());
  if (status !== 200) throw new Error(`the stand-in did not take the Profile text (${status})`);
}

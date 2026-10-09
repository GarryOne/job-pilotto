// Your data: where it lives, export, import, backup, reset.
import {$, message, show} from './core.js';
import {openInNotion, openNotionConnect} from './notion-connect.js';
import {shared} from './shared.js';
import {MOVE_WORDS, movedText} from '../store-move-text.js';
import {toastMessage} from './startup.js';

// ---------- automatic backup of this computer's data (lib/backup.js) ----------
async function showBackup() {
  const status = await window.pilot.backupStatus();
  const where = status.folder.includes('CloudDocs') ? 'iCloud Drive → Job Pilotto Backups' : 'Documents → Job Pilotto Backups';
  $('backup-last').textContent = status.at ? new Date(status.at).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : 'None yet';
  $('backup-where').textContent = where.replace(' → ', ' / ');
}

// ---------- your data: where it lives (lib/store-handlers.js) ----------
// The card's one line of news (an error, "kept on this Mac ✓"): shown only when there is one, so an empty line leaves no gap.
const say = (text, tone) => { message('store-message', text, tone); show($('store-message'), !!text); };
async function showStore() {
  const store = await window.pilot.storeState();
  const cloud = store.caps.includes('cloud'), links = store.caps.includes('links');
  const pill = $('store-pill');
  pill.textContent = store.trying ? 'Not chosen' : store.label;
  pill.className = `ui-pill ${store.trying ? 'tone-warn' : 'tone-good'}`;
  $('store-lead').textContent = store.trying
    ? `Job Pilotto is only trying until your jobs and applications have a home: ${store.choice ? 'this Mac, or your Notion' : 'your Notion'}.`   // about Notion
    : cloud ? 'Your jobs, applications and answers are in your Notion workspace: open and edit them there too.'
      : 'Your jobs, applications and answers are kept on this Mac, in one place, and in its backups. Move them to Notion to use Always on.';   // about Notion
  $('store-where').textContent = store.trying ? 'Not chosen yet' : store.label;
  $('store-cloud').textContent = cloud && !store.trying ? 'Available' : 'Needs Notion';
  show($('store-keep'), store.trying && store.choice);
  show($('store-connect'), store.trying);
  show($('store-move'), !store.trying && !cloud);
  show($('store-open'), links && !!shared.state?.notion?.NOTION_PROFILE_PAGE_ID);
  // The other cards mention Notion only when it holds the data.
  show($('backup-notion-line'), links);
  show($('data-notion-line'), links);
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  showStore();
  $('store-keep').addEventListener('click', async () => {
    $('store-keep').disabled = true;
    const result = await window.pilot.keepOnThisMac();
    $('store-keep').disabled = false;
    if (!result?.ok) { say(result?.error || 'Not changed.', 'error'); return; }
    say('Your data is kept on this Mac ✓', 'ok');
    shared.state = await window.pilot.state();
    showStore();
  });
  $('store-connect').addEventListener('click', () => openNotionConnect({reason: 'none', where: 'settings', from: 'settings', then: () => showStore()}));
  // The move (lib/store-move.js): its progress as it copies, then what moved and which texts Notion already had (kept there, this Mac's in the archive).
  window.pilot.onStoreMoveProgress(({entity, done, total} = {}) =>
    say(`Moving ${MOVE_WORDS[entity] || entity}… ${done} of ${total}`, 'waiting'));
  // "Move my data to Notion": the same prompt as every connect (pages/notion-connect.js, "Connect and move" or "Move to Notion"); its result lands here.
  $('store-move').addEventListener('click', () => openNotionConnect({reason: 'move', where: 'settings', from: 'settings', then: async result => {
    if (!result?.ok) { say(result?.text || result?.error || 'Not moved.', 'error'); return; }
    shared.state = await window.pilot.state();
    await showStore();
    say(movedText(result), 'ok');
  }}));
  $('store-open').addEventListener('click', event => openInNotion('NOTION_PROFILE_PAGE_ID', event));

  // ---------- your data: export / import ----------
  $('export-data').addEventListener('click', async () => {
    $('export-data').disabled = true;
    // Notion data is not exported: it stays in Notion, with Notion's own history, Duplicate, Export and Move (owner, 8 Oct 2026)
    const result = await window.pilot.exportProfile({keys: $('export-keys').checked});
    $('export-data').disabled = false;
    if (result.ok) message('data-message', `Exported ✓ ${result.file}`, 'ok');
    else if (result.error) message('data-message', `Export failed: ${result.error}`, 'error');
  });
  // Settings → Your data, and the setup's Welcome (after a reset the app opens at the setup, where Settings is out of reach: 6 Oct 2026).
  document.querySelectorAll('[data-import]').forEach(button => button.addEventListener('click', async () => {
    const result = await window.pilot.importProfile();
    if (!result?.error) return;
    if (button.id === 'import-data') message('data-message', `Import failed: ${result.error}`, 'error');
    else toastMessage('Import failed', result.error);
  }));
  showBackup();
  $('backup-now').addEventListener('click', async () => {
    $('backup-now').disabled = true;
    const result = await window.pilot.backupNow();
    $('backup-now').disabled = false;
    message('data-message', result.ok ? `Backed up ✓ ${result.file}` : `Backup failed: ${result.error}`, result.ok ? 'ok' : 'error');
    showBackup();
  });
  $('backup-show').addEventListener('click', () => window.pilot.showBackups());

  // ---------- danger zone: reset this computer's Job Pilotto data ----------
  $('reset-confirm').addEventListener('input', () => { $('reset-go').disabled = $('reset-confirm').value.trim() !== 'RESET'; });
  $('reset-go').addEventListener('click', async () => {
    if ($('reset-confirm').value.trim() !== 'RESET') return;
    const result = await window.pilot.resetProfile({backup: $('reset-backup').checked, freshNotion: $('reset-notion').checked});
    if (result?.error) message('reset-message', result.error, 'error');
    else if (!result?.ok) message('reset-message', 'Not reset.', 'waiting');
  });
  $('reset-notion-day').textContent = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}).replace('Sept', 'Sep');
  window.pilot.lastReset().then(done => {
    if (done?.failed) toastMessage('Import or reset did not finish', `${done.failed}. Your data on this computer is as it was; try again.`);
    else if (done?.imported) toastMessage('Data imported ✓', `Your previous data is in ${done.backup}.`);
    // The backup's Profile and tracking are in its Notion workspace (lib/reset.js notionLeftBehind): say which one to connect, before a new one is made.
    if (done?.imported && done.notionElsewhere) toastMessage({title: 'Connect the same Notion workspace',
      body: 'Your Profile and job tracking are in the Notion workspace this backup used. Connect that workspace and pick your existing Job Pilotto page: '
        + 'a new workspace starts with an empty Profile.', target: {view: 'settings', section: 'connections'}});
    else if (done?.backup) toastMessage('Job Pilotto was reset', `Your previous data is in ${done.backup}.`);
    else if (done?.deleted) toastMessage('Job Pilotto was reset', 'Your previous data on this computer was deleted.');
    if (done?.archived) toastMessage('Old Notion workspace archived', `"${done.archived.title}" is kept in Notion. The setup builds a new workspace: share a new, empty page with Job Pilotto.`);   // about Notion
  });
}

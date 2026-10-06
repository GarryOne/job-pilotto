// Your data: export, import, backup, reset.
import {$, message, show} from './core.js';
import {toastMessage} from './startup.js';

// ---------- automatic backup of this computer's data (lib/backup.js) ----------
async function showBackup() {
  const status = await window.pilot.backupStatus();
  const where = status.folder.includes('CloudDocs') ? 'iCloud Drive → Job Pilotto Backups' : 'Documents → Job Pilotto Backups';
  $('backup-last').textContent = status.at ? new Date(status.at).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : 'None yet';
  $('backup-where').textContent = where.replace(' → ', ' / ');
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // ---------- your data: export / import ----------
  window.pilot.onExportProgress(({pages, rows}) => message('data-message', `Copying your Notion data… ${pages} pages, ${rows} rows so far`, 'waiting'));
  $('export-data').addEventListener('click', async () => {
    $('export-data').disabled = true;
    show($('export-cancel'), true);
    const result = await window.pilot.exportProfile({keys: $('export-keys').checked, notion: $('export-notion').checked});
    $('export-data').disabled = false;
    show($('export-cancel'), false);
    if (result.cancelled) message('data-message', 'Export cancelled. No file was saved.', 'waiting');
    else if (result.ok) message('data-message', `Exported ✓ ${result.file}${result.notion ? ` (with Notion: ${result.notion.pages} pages, ${result.notion.rows} rows)` : ''}`, 'ok');
    else if (result.error) message('data-message', `Export failed: ${result.error}`, 'error');
  });
  $('export-cancel').addEventListener('click', () => { message('data-message', 'Cancelling the export…', 'waiting'); window.pilot.exportCancel(); });
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
    else if (done?.backup) toastMessage('Job Pilotto was reset', `Your previous data is in ${done.backup}.`);
    else if (done?.deleted) toastMessage('Job Pilotto was reset', 'Your previous data on this computer was deleted.');
    if (done?.archived) toastMessage('Old Notion workspace archived', `"${done.archived.title}" is kept in Notion. The setup builds a new workspace: share a new, empty page with Job Pilotto.`);
  });
}

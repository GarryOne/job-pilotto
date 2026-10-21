// The busy state of an export, import or backup (Settings → Move your data): "Exporting… 42%" over the shared meter with Cancel, on every strip
// marked data-progress="export|import|backup"; the buttons that start one are disabled while any runs. Fed by main's 'dataProgress' event (lib/data-job.js).
// Guard: desktop/test/data-progress.test.js.
const WORDS = {export: 'Exporting', import: 'Importing', backup: 'Backing up'};
const STARTERS = ['#export-data', '#import-data', '#backup-now', '#reset-export', '[data-import]'];

// -> the strip's text for one event: "Exporting… 42%", or "Exporting…" until the total is known
export function progressText({kind, done, total}) {
  const percent = total ? Math.min(99, Math.floor(done / total * 100)) : null;
  return `${WORDS[kind] || 'Working'}…${percent === null ? '' : ` ${percent}%`}`;
}

function build(strip) {
  strip.classList.add('data-progress');
  const text = document.createElement('span'), track = document.createElement('span'), fill = document.createElement('span'), cancel = document.createElement('button');
  text.className = 'data-progress-text';
  track.className = 'score-track'; fill.className = 'score-fill'; track.append(fill);
  cancel.className = 'ghost'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { cancel.disabled = true; window.pilot.dataCancel(); });
  strip.setAttribute('role', 'status');
  strip.replaceChildren(text, track, cancel);
  return {text, fill, cancel};
}

export function startProgress() {
  const strips = [...document.querySelectorAll('[data-progress]')].map(strip => ({strip, kind: strip.dataset.progress, parts: build(strip)}));
  window.pilot.onDataProgress(event => {
    const running = event.state === 'running';
    for (const {strip, kind, parts} of strips) {
      strip.hidden = !(running && kind === event.kind);
      if (!strip.hidden) {
        parts.text.textContent = progressText(event);
        parts.fill.style.width = event.total ? `${Math.min(100, event.done / event.total * 100)}%` : '0';
        parts.fill.classList.toggle('indeterminate', !event.total);
        parts.cancel.disabled = false;
      }
    }
    for (const selector of STARTERS) document.querySelectorAll(selector).forEach(button => { button.disabled = running; });
    document.body.classList.toggle('data-busy', running);
  });
}

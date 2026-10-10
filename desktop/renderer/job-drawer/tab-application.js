// Drawer → Application: the kit the app drafted (check before sending, lead with, cover letter, form answers: each copyable), the files on
// the job (a tailored CV), the interview preparation and the application's record. Preparation vs Submitted (a snapshot that later edits
// do not change) is the next step; today the record sits at the end. Nothing yet: a state card.
import {el} from '../components.js';
import {allAnswers} from '../job-page-view.js';
import {copyButton, group, stateCard} from './parts.js';

function kitView(kit) {
  if (kit.groups) return kit.groups.map(part => group(part.title, part.lines));
  const parts = [];
  if (kit.intro) parts.push(el('p', 'muted small', kit.intro));
  if (kit.ineligible) parts.push(el('div', 'callout tone-bad', `Not eligible: ${kit.ineligible}`));
  if (kit.check.length) parts.push(group('⚠️ Check before sending', kit.check));
  if (kit.lead.length) parts.push(group('💡 Lead with', kit.lead));
  if (kit.letter) parts.push(group('✉️ Cover letter', kit.letter.split(/\n\s*\n/).map(text => el('div', 'iv-moment', text)), copyButton(kit.letter)));
  if (kit.answers.length) {
    parts.push(group('🧾 Form answers', kit.answers.map(item => {
      // Copy on the question's line, as the cover letter's is on its heading: one place for every Copy in the kit.
      const row = el('div', 'iv-moment');
      const line = el('div', 'job-panel-line');
      line.append(el('b', '', item.review ? `${item.question} ❓` : item.question), copyButton(item.answer));
      row.append(line, el('div', '', item.answer || '—'));
      return row;
    }), copyButton(allAnswers(kit.answers), 'Copy all')));
  }
  return parts;
}

// The job's documents (a tailored CV) as attachment rows: Save asks where and writes the store's copy (IPC jobFileSave); a file too large
// to read here: its name only.
function documentsView(documents) {
  if (!documents.length) return [];
  return [group('📎 Files on this job', documents.map(file => {   // an icon like every section of the kit
    const row = el('div', 'attachment');
    row.append(el('span', 'attachment-name', file.name));
    if (file.url) {
      const save = Object.assign(el('button', 'soft-button', 'Save…'), {type: 'button'});
      save.addEventListener('click', async () => { const done = await window.pilot.jobFileSave(file.name, file.url).catch(() => null); if (done?.ok) save.textContent = 'Saved ✓'; });
      row.append(save);
    }
    else row.append(el('span', 'muted small', 'Too large to show here'));
    return row;
  }))];
}

export function applicationTab({parts}) {
  const nodes = [...(parts.kit ? kitView(parts.kit) : []), ...documentsView(parts.documents || []),
    ...parts.groups.prep.map(part => group(part.title || '🎤 Interview preparation', part.lines)),
    ...parts.groups.record.map(part => group(part.title || '🗂 Application record', part.lines))];
  if (!parts.has.application || !nodes.length) {
    return [stateCard({icon: 'file', title: 'Not prepared', text: 'Apply drafts the kit: a tailored CV, a cover letter and the form\'s answers. It shows here.'})];
  }
  return nodes;
}

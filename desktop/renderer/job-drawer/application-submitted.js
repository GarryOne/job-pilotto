// Application → Submitted: what was actually sent, from the application's frozen record (renderer/job-page-view.js submittedOf): when it was
// recorded and how the answers were captured, the answers and cover letter as sent (an edit from the draft is marked), the CV version and the
// files. It never changes when the kit or CV are edited afterwards. No record: "Not submitted yet", or, for a job marked applied, "No
// application snapshot captured". Opening the employer's page is not proof of submission: only a recorded submission shows here.
import {el} from '../components.js';
import {copyButton, factGrid, group, stateCard} from './parts.js';
import {documentsView} from './application-preparation.js';

export function submittedView({parts, page}) {
  const sent = parts.submitted;
  if (!sent) {
    return [page?.app?.applied_on
      ? stateCard({icon: 'info', title: 'No application snapshot captured', text: 'This job was marked as applied, but what was sent was not recorded (applied elsewhere, or before snapshots).'})
      : stateCard({icon: 'file', title: 'Not submitted yet', text: 'When you submit, what was sent is saved here: the answers, the cover letter and the CV version.'})];
  }
  const nodes = [stateCard({icon: 'check-circle', tone: 'good', title: sent.when ? `Submitted ${sent.when}` : 'Submitted', text: sent.note || 'Recorded when the application was submitted.'})];
  if (sent.facts.length) nodes.push(factGrid(sent.facts));
  if (sent.answers.length) {
    nodes.push(group('🧾 Form answers sent', sent.answers.map(item => {
      const row = el('div', 'iv-moment');
      const line = el('div', 'job-panel-line');
      line.append(el('b', '', item.question), copyButton(item.answer));
      row.append(line, el('div', '', item.answer || '—'), ...(item.edited ? [el('span', 'muted small', '✏️ edited from the draft')] : []));
      return row;
    })));
  }
  if (sent.letter) nodes.push(group('✉️ Cover letter sent', sent.letter.split(/\n\s*\n/).map(text => el('div', 'iv-moment', text)), copyButton(sent.letter)));
  nodes.push(...documentsView(parts.documents || [], '📎 Documents'));
  nodes.push(el('p', 'muted small', 'Later edits to the kit or the CV do not change this snapshot.'));
  return nodes;
}

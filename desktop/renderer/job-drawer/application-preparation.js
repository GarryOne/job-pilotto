// Application → Preparation: what the app drafted for the application: the kit (check before sending, lead with, form answers:
// each copyable) and the interview preparation. The cover letter and the tailored CV are in the Documents tab (tab-documents.js). Not drafted yet: a state card.
import {el} from '../components.js';
import {checkPill} from '../no-mark.js';
import {allAnswers} from '../job-page-view.js';
import {copyButton, group, stateCard} from './parts.js';
import {jobQuestionsView} from './application-questions.js';
import {ownKeyHint} from '../own-key-hint.js';
import {shared} from '../pages/shared.js';

function kitView(kit) {
  if (kit.groups) return kit.groups.map(part => group(part.title, part.lines));
  const parts = [];
  if (kit.intro) parts.push(el('p', 'muted small', kit.intro));
  if (kit.ineligible) parts.push(el('div', 'callout tone-bad', `Not eligible: ${kit.ineligible}`));
  if (kit.check.length) parts.push(group('⚠️ Check before sending', kit.check));
  if (kit.lead.length) parts.push(group('💡 Lead with', kit.lead));
  if (kit.answers.length) {
    parts.push(group('🧾 Form answers', kit.answers.map(item => {
      // Copy on the question's line, as the cover letter's is on its heading: one place for every Copy in the kit.
      const row = el('div', 'iv-moment');
      const line = el('div', 'job-panel-line');
      const title = el('span');   // the question and its pill stay together on the left; Copy sits on the right
      title.append(el('b', '', item.question), ...(item.review ? [' ', checkPill()] : []));
      line.append(title, copyButton(item.answer));
      row.append(line, el('div', '', item.answer || '—'));
      return row;
    }), copyButton(allAnswers(kit.answers), 'Copy all')));
  }
  return parts;
}

export function preparationView({job, parts}) {
  const nodes = [...(parts.kit ? kitView(parts.kit) : []),
    ...parts.groups.prep.map(part => group(part.title || '🎤 Interview preparation', part.lines)), ...jobQuestionsView(job)];
  const filled = nodes.length > 0 && (parts.has.application || parts.groups.prep.length > 0);
  if (!filled) return [stateCard({icon: 'file', title: 'Not prepared', text: 'Apply drafts the kit: what to check, what to lead with and the form\'s answers. It shows here. The CV and cover letter are under Documents.'})];
  // The kit was written by the engine now in charge: on Free AI, a one-time hint that an own key writes stronger (own-key-hint.js).
  const hint = parts.kit && ownKeyHint(shared.state, {openSettings: () => import('../pages/settings.js').then(({openSetting}) => openSetting('ai'))});
  return hint ? [...nodes, hint] : nodes;
}

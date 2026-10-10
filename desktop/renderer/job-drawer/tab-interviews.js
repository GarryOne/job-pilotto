// Drawer → Interviews: the interviews of this job: the next one and its prep date, what the calls said. The interview records, recordings
// and transcripts (Interviews page) come next; until then an explanatory empty state.
import {el} from '../components.js';
import {interviewFacts} from '../job-page-view.js';
import {group, stateCard} from './parts.js';

export function interviewsTab({page}) {
  const facts = interviewFacts(page?.app);
  if (!facts) return [stateCard({icon: 'calendar', title: 'No interviews yet', text: 'When an interview is scheduled or practised for this job, it shows here with its prep, recording and transcript.'})];
  return [group('Interviews', [el('div', 'iv-moment', facts)])];
}

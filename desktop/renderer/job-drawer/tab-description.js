// Drawer → Description: the posting as saved on the job (or frozen in its application record). None saved: a state card.
import {group, stateCard} from './parts.js';

export function descriptionTab({parts}) {
  const groups = parts.groups.description;
  if (!groups.length) return [stateCard({icon: 'file', tone: 'warn', title: 'This job has no saved description', text: 'A copy of the original posting is saved with the job once it is read.'})];
  return groups.map(part => group(part.title, part.lines));
}

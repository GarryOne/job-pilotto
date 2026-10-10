// Drawer → Application, in two parts (owner's spec, 10 Oct 2026): Preparation (what the app drafted) and Submitted (what was actually sent,
// frozen at submission). Opens on Submitted when a snapshot exists, else on Preparation; the choice is kept per job for the session.
import {choice} from './parts.js';
import {preparationView} from './application-preparation.js';
import {submittedView} from './application-submitted.js';

const chosen = new Map();   // job url → 'preparation' | 'submitted'
const OPTIONS = [['preparation', 'Preparation'], ['submitted', 'Submitted']];

export function applicationTab(ctx, redraw) {
  const active = chosen.get(ctx.job.url) || (ctx.parts.submitted ? 'submitted' : 'preparation');
  const body = active === 'submitted' ? submittedView(ctx) : preparationView(ctx);
  return [choice(OPTIONS, active, key => { chosen.set(ctx.job.url, key); redraw(); }, 'Application'), ...body];
}

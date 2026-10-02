// After Dismiss: a one-tap "why?" (optional, gone in 12 seconds). The reason is one of a fixed list and is counted with the job's score band only
// (site /intelligence), so the scorer and the filters can learn why jobs get turned down. Never the job, its title or its company.
import {REASONS, scoreBucket} from '../intel.js';
import {$} from './core.js';

export function askWhy(job) {
  const toast = Object.assign(document.createElement('div'), {className: 'toast why-toast'});
  toast.append(Object.assign(document.createElement('b'), {textContent: 'Dismissed. Why?'}));
  const chips = Object.assign(document.createElement('div'), {className: 'why-chips'});
  for (const reason of REASONS) {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'why-chip', textContent: reason.label});
    button.addEventListener('click', event => {
      event.stopPropagation();
      window.pilot.dismissReason({reason: reason.id, bucket: scoreBucket(job.fit)}).catch(() => {});
      toast.remove();
    });
    chips.append(button);
  }
  toast.append(chips);
  toast.addEventListener('click', event => { if (event.target === toast) toast.remove(); });
  $('toasts').append(toast);
  setTimeout(() => toast.remove(), 12000);
  return toast;
}

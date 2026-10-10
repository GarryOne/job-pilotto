// The score ring: a circle filled to the fit, the number inside (style.css .fit-ring). Drawn by the Jobs list rows and the job drawer's
// header, so both read the same. `size` adds a modifier class ('lg' in the drawer).
import {el} from './components.js';

export function fitRing(fit, size = '') {
  const ring = el('div', size ? `fit-ring ${size}` : 'fit-ring');
  ring.style.setProperty('--p', fit ?? 0);
  ring.append(el('span', '', fit ?? '–'));
  return ring;
}

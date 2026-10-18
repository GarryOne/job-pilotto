// Your details' contact form while it is being read: the boxes marked data-reads-contact are replaced by the shared skeleton until the answer is in, so an empty input never
// stands for "not read yet" (owner, 18 Oct 2026: the form showed empty fields beside "Saved in Notion" and read as "my data is gone"; Experience got this on 17 Oct, 3db551c).
// Guarded by test/contact-reading.test.js.
import {loadingCard} from './components.js';

const skeletons = new Map();
export function reading(on, root = document) {
  for (const node of root.querySelectorAll('[data-reads-contact]')) {
    skeletons.get(node)?.remove();
    skeletons.delete(node);
    node.hidden = on;
    if (!on) continue;
    const card = loadingCard('Reading your details…', [60, 80, 50]);
    card.classList.add('contact-reading');
    node.parentNode.insertBefore(card, node);
    skeletons.set(node, card);
  }
}

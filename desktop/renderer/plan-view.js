// The Pro plan's words and numbers for the window (Settings → License → Plan, the sidebar counter, ⌘K), kept free of the DOM so a test can read them
// (spec docs/superpowers/specs/2026-10-16-pro-plan.md §4, owner decisions 16 Oct 2026): the AI credit is a bar and a percent, never dollars or "applications left";
// "one-time payment, no subscription", never "lifetime"; the own key is the way out when the credit runs low. The top-up credits are the site's (site/src/pro-pay.js CREDIT).
export const TOPUPS = [{kind: 'topup5', price: '$5', credit: '$2.80'}, {kind: 'topup10', price: '$10', credit: '$5.80'}, {kind: 'topup20', price: '$20', credit: '$11.80'}];
export const INCLUDED = ['Unlimited applications, no time limit', '$5 of our AI included: enough for about a whole job search', 'Your own AI key: unlimited, nothing counted',
  'Top-ups when you need more AI: $5, $10 or $20, one-time', '14-day refund, any reason', 'Your data stays yours: on your Mac and in your own Notion'];
export const TOPUP_NOTE = 'Top-ups are one-time: $5 adds $2.80 of AI credit, $10 adds $5.80, $20 adds $11.80 (VAT is included in the price).';
export const OWN_KEY = 'Your own key is unlimited and saves your AI credit.';
export const NOTES = {
  30: 'Your AI credit is at 30%. Add credit anytime, or use your own AI key: it is unlimited and saves your credit.',
  10: 'Your AI credit is at 10%. Add credit anytime, or use your own AI key: it is unlimited and saves your credit.',
  0: 'Your AI credit is used up. Add credit, or use your own AI key in Settings → AI engine (your own key is unlimited).',
};

// What the Plan card shows for the site's answer: null when the plan is off (nothing about Pro is on screen).
export function planView(plan = {}) {
  if (!['test', 'live'].includes(plan.mode)) return null;
  const base = {mode: plan.mode, title: plan.plan === 'pro' ? 'Your plan' : 'Upgrade to Pro'};
  if (plan.plan !== 'pro') {
    const offer = plan.offer || {price: '29', launch: ''}, launch = offer.launch ? ` Launch price while it lasts; usually $${offer.price}.` : '';
    return {...base, kind: 'upgrade', pill: 'Free', price: `$${offer.launch || offer.price} one-time, no subscription.${launch}`, included: INCLUDED, button: 'Pay securely with Stripe'};
  }
  const percent = Math.max(0, Math.min(100, plan.creditPercent ?? 0));
  return {...base, kind: 'pro', pill: 'Pro', percent, label: `AI credit: ${percent}% left`, tone: (plan.warn ?? 99) <= 10 ? 'bad' : 'info', note: NOTES[plan.warn] || OWN_KEY, warn: plan.warn ?? null, topups: TOPUPS};
}

// The warning to say once per step (30, 10, then 0): which steps were already said, and what to say now. -> {say: 30 | 10 | 0 | null, said: [...]}
export function warnNow(warn, said = []) {
  if (warn == null) return {say: null, said: []};   // above 30% again: the steps are new next time
  return said.includes(warn) ? {say: null, said} : {say: warn, said: [...said, warn]};
}

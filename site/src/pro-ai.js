// The Pro lane of Free AI (spec docs/superpowers/specs/2026-10-16-pro-plan.md §3): an install on a Pro account with credit runs in its own lane, immune to the
// global Free AI daily stop and the per-install caps (only the rate limit applies), and each call's cost is taken from the account's credit.
// Credit used up (past the small overdraft): no free fallback, the answer says top-up or own key. Own-key AI never reaches this route. Guard: test/pro-credit.test.js.
import {OVERDRAFT_MICRO, accountOf, planOn, spend} from './pro.js';

export const PRO_PER_MINUTE = 50;   // the only brake in the Pro lane (owner, 16 Oct 2026)
export const CREDIT_OUT = 'Your AI credit is used up. Add credit, or use your own Claude or ChatGPT key in Settings → AI engine (your own key is unlimited).';

// -> null (not Pro: the Free rules), {blocked: message} (credit gone), or {account} (the Pro lane).
export async function proLane(env, install) {
  if (!planOn(env) || !install) return null;   // a founder/friend key (JP1.) has no install: the Free rules
  const account = await accountOf(env, install);
  if (!account || account.status !== 'active' || account.plan !== 'pro') return null;   // a trial account has the Free rules
  return account.credit_micro <= -OVERDRAFT_MICRO ? {blocked: CREDIT_OUT} : {account};
}

// The call's own cost (micro-USD, the figure ai_calls records) from the credit; nothing for the Free rules.
export const chargeCall = (env, lane, micro, action, now) => (lane?.account ? spend(env, lane.account.id, micro, action || 'other', now) : null);

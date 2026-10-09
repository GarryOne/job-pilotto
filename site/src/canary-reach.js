// Who gets a learned item (recipe, wording meaning, page meaning) while it is a canary. Verified: everyone. Canary: the installs in its rollout
// share (recipe-schema.js appliesTo, a stable bucket per install), AND every install that opted into beta (the app's Settings → Beta, sent as
// the header X-Beta: 1). Owner, 9 Oct 2026: with one or two installs, a 5% bucket may hold no one, so a canary was never used and never judged;
// beta installs test new learning first, as they test new app versions. Guarded by site/test/canary-reach.test.js.
import {appliesTo} from '../../extension/recipe-schema.js';

// The staged rollout is OFF for now (owner, 9 Oct 2026: "We can disable the canary promotion mechanism for now. We'll re-enable it in the future,
// when we'll have a higher user base"): with few installs, each on different sites, a staged item reaches almost no one. Off, a learned item in
// canary reaches every install at once. Kept either way: the validators, the hourly judge that halts or rolls back what fails in real use, and
// the per-item kill switch (status disabled). RE-ENABLE with a larger user base: LEARNING_CANARY = "on" in wrangler.toml [vars].
export const staged = env => env?.LEARNING_CANARY === 'on';
export const betaOf = request => request?.headers?.get?.('X-Beta') === '1';
export const reaches = ({status, rollout}, install, {beta = false, stage = false} = {}) =>
  status === 'verified' || (status === 'canary' && (!stage || beta || appliesTo({rollout}, install)));

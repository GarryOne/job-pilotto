// Who gets a learned item (recipe, wording meaning, page meaning) while it is a canary. Verified: everyone. Canary: the installs in its rollout
// share (recipe-schema.js appliesTo, a stable bucket per install), AND every install that opted into beta (the app's Settings → Beta, sent as
// the header X-Beta: 1). Owner, 9 Oct 2026: with one or two installs, a 5% bucket may hold no one, so a canary was never used and never judged;
// beta installs test new learning first, as they test new app versions. Guarded by site/test/canary-reach.test.js.
import {appliesTo} from '../../extension/recipe-schema.js';

export const betaOf = request => request?.headers?.get?.('X-Beta') === '1';
export const reaches = ({status, rollout}, install, beta = false) =>
  status === 'verified' || (status === 'canary' && (beta || appliesTo({rollout}, install)));

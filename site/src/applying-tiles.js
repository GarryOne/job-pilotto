// The one colour rule of the tiles on /admin/lab-form-filling (owner, 15 Oct 2026): a share of a GOOD thing is green at or above its target, amber in a middle band, red below;
// a count of a BAD thing is green at 0, amber when small, red above. Thresholds live here only; the tooltips are written from them. Guard: test/applying-tiles.test.js.
export const SHARE = {target: 70, floor: 50};   // % resolved, % that reached the form: green at 70 or more, amber 50-69, red under 50
export const COUNT = {small: 3};                // regressions of our build, sites needing a fix, boards dropped: green 0, amber 1-3, red 4 or more

export const shareTone = value => (value == null ? '' : value >= SHARE.target ? 'good' : value >= SHARE.floor ? 'warn' : 'bad');
export const countTone = value => (value == null ? '' : value === 0 ? 'good' : value <= COUNT.small ? 'warn' : 'bad');

const SHARE_WORDS = `Green at ${SHARE.target}% or more, amber ${SHARE.floor}-${SHARE.target - 1}%, red under ${SHARE.floor}%.`;
const COUNT_WORDS = `Green at 0, amber 1-${COUNT.small}, red ${COUNT.small + 1} or more.`;
export const TILE_RULE = {resolved: SHARE_WORDS, reached: SHARE_WORDS, regressions: COUNT_WORDS, needFix: COUNT_WORDS, dropped: COUNT_WORDS};

// tiles: the page's data().tiles (regressions already without the postings that are gone) and resolution.raw -> each coloured tile's tone and rule.
export const tileTones = (tiles, resolved) => ({resolved: shareTone(resolved), reached: shareTone(tiles.reachedForm), regressions: countTone(tiles.regressions), needFix: countTone(tiles.needFix), dropped: countTone(tiles.dropped)});

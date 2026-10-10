// Which view the session card's Claude offer shows (renderer/claude-offer.js), as a pure function so a test can drive it without a window.
// hidden: Claude is not ready or the person said "I'll do it myself"; consent: the first press asked its one line; offer: the three choices.
export const cardOffer = ({help, dismissed, asking}) => (!help || dismissed ? 'hidden' : asking ? 'consent' : 'offer');

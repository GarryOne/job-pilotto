// A count on a menu badge, capped so it fits the icon rail: 474 reads "99+". Guarded by test/rail-badges.test.js.
export const badgeLabel = count => (Number(count) > 99 ? '99+' : String(count));

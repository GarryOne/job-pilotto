// The extension's word for a session's page as it happens (extension/page-mark.js) -> the card's line (lib/review.js notePage), logged once per change. One function for the app
// (ext-server-handlers.js) and the journey tests' offline app (e2e/lib/offline-app-child.mjs), so the card moves the same way in both. Guard: desktop/test/page-steps.test.js.
export const pageStepHandler = ({terminals, review, appLog}) => ({session, page} = {}) => {
  if (session && terminals.get(String(session)) && review.notePage(String(session), String(page || ''))) appLog('review', `page ${session}: ${page}`);
};

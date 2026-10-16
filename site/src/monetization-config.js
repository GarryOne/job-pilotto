// The numbers the Monetization page (src/monetization.js) judges by: colour lines for the conversion, the trial size and the fixed yearly costs. Edit here, not in the page.
export const TRIAL_MIN_FOR_VERDICT = 50;          // below this many completed trials the conversion says "not enough trials yet" (owner, 16 Oct 2026: judge after 50-100)
export const CONVERSION_GREEN = 0.05, CONVERSION_YELLOW = 0.02;   // >= 5% 🟢, 2-5% 🟡, < 2% 🔴
export const TRIAL_APPLICATIONS = 20;             // a trial is complete at 20 applications or when the app reports its allowance ended (60 days)
// Fixed costs per year in USD: the figures of the Notion page "Profit projections" (an estimate; the page labels them so). The page shares them over the range shown.
export const FIXED_COSTS_YEAR = [['Cloudflare Workers Paid', 60], ['Domain', 5], ['Apple Developer', 99], ['Windows signing', 250], ['Bookkeeping SaaS', 100]];
export const PROJECTIONS_URL = 'https://app.notion.com/p/3fb62be8fd86816eb1e7dfbbcb17de5a';
// The Claude subscription is personal and never counted here.

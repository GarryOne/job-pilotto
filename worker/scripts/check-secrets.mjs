// After `npm run deploy`: the secrets the Worker's schedules need are set on the deployed Worker. A deploy that created the Worker afresh (5 Oct 2026, the cron
// commit) left it with none: every scheduled start was refused for a day, and the Telegram warning about it could not be sent either. Exit 1 names what is missing.
//   node scripts/check-secrets.mjs        (wrangler's own login, or CLOUDFLARE_API_TOKEN)
import {execFileSync} from 'node:child_process';

export const REQUIRED = {GITHUB_TOKEN: 'starts the scheduled workflows (actions: write on the repo)', TELEGRAM_BOT_TOKEN: 'sends the warning when a start fails', OWNER_CHAT_ID: 'where that warning goes'};
export const missing = names => Object.keys(REQUIRED).filter(name => !names.includes(name));

if (import.meta.url === `file://${process.argv[1]}`) {
  let names;
  try { names = JSON.parse(execFileSync('npx', ['wrangler@4', 'secret', 'list', '--format', 'json'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']})).map(item => item.name); }
  catch (error) { console.error(`Could not list the Worker's secrets (${error.message.split('\n')[0]}): check them with npx wrangler secret list.`); process.exit(1); }
  const gone = missing(names);
  if (gone.length) {
    console.error(`The deployed Worker lacks ${gone.map(name => `${name} (${REQUIRED[name]})`).join(', ')}. Set each: npx wrangler secret put <NAME>`);
    process.exit(1);
  }
  console.log(`Worker secrets: ${Object.keys(REQUIRED).join(', ')} are set.`);
}

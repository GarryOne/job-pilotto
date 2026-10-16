// The Cloudflare account's own count of Workers AI neurons today (GraphQL analytics): any caller of the account is in it, not only this Worker (16 Oct 2026: an eval run used the day's
// whole free allowance and the Worker's own counter never saw it). Asked at most once a minute, kept in KV; null when the account settings are missing or Cloudflare cannot be read.
export const USAGE_TTL_MS = 60_000;

const QUERY = (account, day) => `query { viewer { accounts(filter: {accountTag: "${account}"}) { aiInferenceAdaptiveGroups(limit: 1, filter: {datetimeHour_geq: "${day}T00:00:00Z"}) { sum { totalNeurons } } } } }`;

export async function accountNeurons(env, kv, day, now, fetcher = fetch) {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return null;
  const key = `freeai:acctneu:${day}`;
  const cached = JSON.parse((await kv.get(key)) || 'null');
  if (cached && now.getTime() - cached.at < USAGE_TTL_MS) return cached.n;
  try {
    const response = await fetcher('https://api.cloudflare.com/client/v4/graphql', {method: 'POST', headers: {authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'application/json'},
      body: JSON.stringify({query: QUERY(env.CF_ACCOUNT_ID, day)})});
    const n = Number((await response.json())?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups?.[0]?.sum?.totalNeurons);
    if (!Number.isFinite(n)) return cached?.n ?? null;
    await kv.put(key, JSON.stringify({n, at: now.getTime()}), {expirationTtl: 2 * 86400});
    return n;
  } catch { return cached?.n ?? null; }
}

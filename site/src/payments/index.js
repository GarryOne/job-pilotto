// The payment layer's one small interface (owner, 16 Oct 2026: "Stripe for now… I can switch later"): the accounts and the ledger call these three functions and
// see only our event shape. Today the adapter is Stripe (./stripe.js); a merchant of record is a new adapter file and a var, not a rewrite. Guard: site/test/pro-stripe.test.js.
import * as stripe from './stripe.js';

const adapters = {stripe};
export const adapter = env => adapters[env.PAYMENT_PROVIDER || 'stripe'];
export const providerName = env => env.PAYMENT_PROVIDER || 'stripe';

// -> {url} | {error}
export const createCheckout = (env, order, fetcher) => adapter(env).createCheckout(env, order, fetcher);
// raw body + the request's headers (the adapter reads its own signature header) -> {id, type: 'paid' | 'refunded' | 'disputed' | 'ignored', ref, …} or null when not genuinely from the provider
export const verifyEvent = (rawBody, headers, env, now) => adapter(env).verifyEvent(rawBody, headers, env, now);
// the processor fee in cents for a payment, or null until known
export const feeOf = (env, ref, fetcher) => adapter(env).feeOf(env, ref, fetcher);
// the secret key matches the plan's mode (test keys for "test", live keys for "live")
export const keyMatchesMode = env => adapter(env).keyMatchesMode(env);

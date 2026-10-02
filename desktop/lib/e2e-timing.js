// Waits the end-to-end journey may shorten so a test does not sit through them (never for a user): JOB_PILOTTO_E2E_<NAME> in milliseconds, only with JOB_PILOTTO_E2E set.
export const e2eMs = (name, fallback, env = process.env) => (env.JOB_PILOTTO_E2E ? Number(env[`JOB_PILOTTO_E2E_${name}`]) || fallback : fallback);

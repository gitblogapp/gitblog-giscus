type Credential = { token: string; expires_at: string };

// Cache only completed credentials within this Worker instance, never request-bound I/O.
// Authorization checks still run on every request in getAppAccess.
const tokens = new Map<string, Credential>();
const MAX_ENTRIES = 256;
const EXPIRY_MARGIN_MS = 60_000;
const isFresh = (value: Credential) => Date.parse(value.expires_at) > Date.now() + EXPIRY_MARGIN_MS;

export const TokenCache = {
  get(key: string) {
    const value = tokens.get(key);
    if (!value) return undefined;
    tokens.delete(key);
    if (!isFresh(value)) return undefined;
    tokens.set(key, value);
    return value;
  },
  set(key: string, value: Credential) {
    tokens.delete(key);
    if (!value.token || !isFresh(value)) return;
    for (const [existingKey, existing] of tokens) {
      if (!isFresh(existing)) tokens.delete(existingKey);
    }
    if (tokens.size >= MAX_ENTRIES) tokens.delete(tokens.keys().next().value);
    tokens.set(key, value);
  },
  delete(key: string) {
    tokens.delete(key);
  },
};

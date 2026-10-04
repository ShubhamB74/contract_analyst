/**
 * Tiny in-memory sliding-window limiter. The app has no login and the deployed link is public, so
 * without this anyone could run up the AI bill. Limits are per client IP and per bucket.
 * Override with RATE_LIMIT_CHAT / RATE_LIMIT_UPLOAD / RATE_LIMIT_COMPARE (requests per 10 minutes).
 */
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;

export function checkRate(key: string, max: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return { ok: true, retryAfterSec: 0 };
}

const DEFAULTS = { chat: 40, upload: 30, compare: 12 } as const;
export type Bucket = keyof typeof DEFAULTS;

export const limitFor = (b: Bucket) => Number(process.env[`RATE_LIMIT_${b.toUpperCase()}`] ?? DEFAULTS[b]);
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";

/** Returns a 429 Response when over the limit, else null. `ndjson` keeps the chat client's stream parser happy. */
export function rateLimited(req: Request, bucket: Bucket, ndjson = false): Response | null {
  const r = checkRate(`${bucket}:${clientIp(req)}`, limitFor(bucket));
  if (r.ok) return null;
  const message = `Too many requests. Please wait about ${Math.ceil(r.retryAfterSec / 60)} minute(s) and try again.`;
  const headers = { "Retry-After": String(r.retryAfterSec) };
  return ndjson
    ? new Response(JSON.stringify({ type: "error", message }) + "\n", { status: 429, headers: { ...headers, "Content-Type": "application/x-ndjson" } })
    : Response.json({ error: message }, { status: 429, headers });
}

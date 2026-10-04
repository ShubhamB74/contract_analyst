import { describe, it, expect } from "vitest";
import { checkRate, rateLimited } from "../src/lib/ratelimit";

describe("rate limit", () => {
  it("allows up to the max, then blocks with a retry hint, then recovers", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRate("k1", 3, t0 + i).ok).toBe(true);
    const blocked = checkRate("k1", 3, t0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(500);
    expect(checkRate("k1", 3, t0 + 11 * 60 * 1000).ok).toBe(true); // window passed
  });
  it("tracks clients separately", () => {
    for (let i = 0; i < 2; i++) checkRate("a", 2, 5);
    expect(checkRate("a", 2, 6).ok).toBe(false);
    expect(checkRate("b", 2, 6).ok).toBe(true);
  });
  it("returns an NDJSON error the chat client can display, and a JSON error otherwise", async () => {
    process.env.RATE_LIMIT_CHAT = "1"; process.env.RATE_LIMIT_UPLOAD = "1";
    const req = () => new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9" } });
    expect(rateLimited(req(), "chat", true)).toBeNull();
    const res = rateLimited(req(), "chat", true)!;
    expect(res.status).toBe(429);
    expect(JSON.parse((await res.text()).trim())).toMatchObject({ type: "error" });
    rateLimited(req(), "upload");
    const j = rateLimited(req(), "upload")!;
    expect((await j.json()).error).toMatch(/Too many requests/);
  });
});

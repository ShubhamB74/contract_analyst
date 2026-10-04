// Runs once when the Next.js server starts (not in the browser, not on the edge runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverStuckJobs } = await import("./lib/jobs");
  recoverStuckJobs().then(
    (r) => { if (r.documents || r.comparisons) console.log(`[recovery] resumed ${r.documents} document(s), ${r.comparisons} comparison(s)`); },
    (e) => console.error("[recovery] failed", e)
  );
}

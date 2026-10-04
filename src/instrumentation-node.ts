import { recoverStuckJobs } from "./lib/jobs";

recoverStuckJobs().then(
  (r) => { if (r.documents || r.comparisons) console.log(`[recovery] resumed ${r.documents} document(s), ${r.comparisons} comparison(s)`); },
  (e) => console.error("[recovery] failed", e)
);

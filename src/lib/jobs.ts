/**
 * Background work that must survive a server restart.
 * Upload extraction and comparisons run in-process; if the server dies mid-job the DB row is left as
 * "processing"/"running" forever. recoverStuckJobs() (called once at boot from instrumentation.ts)
 * re-runs them from the saved upload file, so nothing stays stuck.
 */
import fs from "fs";
import { getDb } from "./db";
import { extract, UserFacingError } from "./extract";
import { runComparison } from "./compare";

export async function processDocument(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT name, file_path FROM documents WHERE id=?").get(id) as { name: string; file_path: string | null } | undefined;
  if (!row) return;
  try {
    if (!row.file_path || !fs.existsSync(row.file_path)) throw new UserFacingError("The uploaded file is missing on the server. Please upload it again.");
    const r = await extract(row.name, fs.readFileSync(row.file_path));
    db.prepare("UPDATE documents SET status='ready', error=NULL, text=?, pages_json=?, page_count=?, char_count=? WHERE id=?")
      .run(r.text, JSON.stringify(r.pages), r.pageCount, r.text.length, id);
  } catch (e) {
    const msg = e instanceof UserFacingError ? e.message : "Could not read this file. It may be corrupted or password-protected.";
    db.prepare("UPDATE documents SET status='failed', error=? WHERE id=?").run(msg, id);
  }
}

export async function recoverStuckJobs() {
  const db = getDb();
  const docs = db.prepare("SELECT id FROM documents WHERE status='processing'").all() as { id: string }[];
  const comps = db.prepare("SELECT id FROM comparisons WHERE status='running'").all() as { id: string }[];
  for (const d of docs) await processDocument(d.id);
  for (const c of comps) await runComparison(c.id);
  return { documents: docs.length, comparisons: comps.length };
}

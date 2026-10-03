import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/** Runs the real background job against a temp SQLite DB with NO AI key (fallback path). */
describe("comparison job without an AI key", () => {
  it("completes with rule-based summaries and a visible warning", async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ca-"));
    process.env.AI_API_KEY = "";
    const { getDb } = await import("../src/lib/db");
    const { extractPdf } = await import("../src/lib/extract");
    const { runComparison } = await import("../src/lib/compare");

    const db = getDb();
    for (const [id, file] of [["a", "contract_v1.pdf"], ["b", "contract_v2.pdf"]]) {
      const ex = await extractPdf(fs.readFileSync(`tests/fixtures/${file}`));
      db.prepare("INSERT INTO documents (id,name,mime,status,text,pages_json,page_count,char_count) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, file, "application/pdf", "ready", ex.text, JSON.stringify(ex.pages), ex.pageCount, ex.text.length);
    }
    db.prepare("INSERT INTO comparisons (id,doc_a,doc_b,status) VALUES ('x','a','b','running')").run();
    await runComparison("x");

    const row = db.prepare("SELECT status, error, result_json FROM comparisons WHERE id='x'").get() as any;
    expect(row.status).toBe("done");
    const r = JSON.parse(row.result_json);
    expect(r.changes).toHaveLength(5);
    expect(r.aiError).toBeTruthy();
    expect(r.changes.every((c: any) => c.source === "heuristic")).toBe(true);
    expect(r.overview).toMatch(/5 clauses differ/);
    const liab = r.changes.find((c: any) => c.heading === "Liability");
    expect(liab.significance).toBe("high");
    expect(liab.figures.added).toEqual(["AED 1,000,000"]);
  });
});

import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

describe("restart recovery", () => {
  it("re-processes documents and comparisons left stuck by a restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-"));
    process.env.DATA_DIR = dir; process.env.AI_API_KEY = "";
    fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
    const put = (name: string, src: string) => { const p = path.join(dir, "uploads", name); fs.copyFileSync(src, p); return p; };

    const { getDb } = await import("../src/lib/db");
    const { recoverStuckJobs, processDocument } = await import("../src/lib/jobs");
    const db = getDb();
    const ins = (id: string, name: string, fp: string | null) =>
      db.prepare("INSERT INTO documents (id,name,mime,status,file_path) VALUES (?,?,?,?,?)").run(id, name, "application/pdf", "processing", fp);
    ins("a", "v1.pdf", put("a.pdf", "samples/services_agreement_v1.pdf"));
    ins("b", "v2.pdf", put("b.pdf", "samples/services_agreement_v2.pdf"));
    ins("s", "scan.pdf", put("s.pdf", "samples/scanned_no_text.pdf"));
    ins("m", "gone.pdf", path.join(dir, "uploads", "missing.pdf"));
    db.prepare("INSERT INTO comparisons (id,doc_a,doc_b,status) VALUES ('c','a','b','running')").run();

    const r = await recoverStuckJobs();
    expect(r).toEqual({ documents: 4, comparisons: 1 });

    const st = (id: string) => db.prepare("SELECT status,error,page_count FROM documents WHERE id=?").get(id) as any;
    expect(st("a").status).toBe("ready");
    expect(st("b").status).toBe("ready");
    expect(st("s").status).toBe("failed");
    expect(st("s").error).toMatch(/no readable text/i);          // scanned PDF: never saved as an empty "ready" doc
    expect(st("m").status).toBe("failed");
    expect(st("m").error).toMatch(/missing on the server/i);
    expect((db.prepare("SELECT status FROM comparisons WHERE id='c'").get() as any).status).toBe("done");
    await processDocument("nope"); // unknown id must not throw
  });
});

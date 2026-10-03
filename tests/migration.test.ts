import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

describe("steps_json migration", () => {
  it("upgrades a pre-Phase-8 database and round-trips research steps", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
    process.env.DATA_DIR = dir;
    // Build an OLD database: messages table without steps_json, with an existing row.
    const old = new Database(path.join(dir, "app.db"));
    old.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, doc_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL,
        quotes_json TEXT NOT NULL DEFAULT '[]', coverage_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'complete', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO conversations (id, doc_key) VALUES ('c1','d1');
      INSERT INTO messages (id, conversation_id, role, content) VALUES ('m0','c1','user','old question');`);
    old.close();

    const { addMessage, listMessages } = await import("../src/lib/repo");
    addMessage("c1", { id: "m1", role: "assistant", content: "a", quotes: [], coverage: [], steps: ["Searched for “x”: 2 passages"], status: "complete" });
    const msgs = listMessages("c1");
    expect(msgs[0].content).toBe("old question");   // existing data survives
    expect(msgs[0].steps).toEqual([]);                // old rows default to no steps
    expect(msgs[1].steps).toEqual(["Searched for “x”: 2 passages"]);
  });
});

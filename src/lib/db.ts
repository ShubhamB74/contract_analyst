import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  page_count INTEGER,
  char_count INTEGER,
  text TEXT,
  pages_json TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- A conversation is tied to a set of documents (1 = single-doc chat, N = Phase 6).
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  doc_key TEXT NOT NULL UNIQUE,   -- sorted doc ids joined by ","
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  quotes_json TEXT NOT NULL DEFAULT '[]',
  coverage_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'complete',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Phase 7: older version (doc_a) vs newer version (doc_b).
CREATE TABLE IF NOT EXISTS comparisons (
  id TEXT PRIMARY KEY,
  doc_a TEXT NOT NULL,
  doc_b TEXT NOT NULL,
  status TEXT NOT NULL,           -- running | done | failed
  progress TEXT,
  error TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const g = globalThis as unknown as { __db?: Database.Database };

export function getDb(): Database.Database {
  if (g.__db) return g.__db;
  fs.mkdirSync(path.join(config.dataDir, "uploads"), { recursive: true });
  const db = new Database(path.join(config.dataDir, "app.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  // Phase 8: older databases lack the column. CREATE IF NOT EXISTS won't add it, so migrate by hand.
  try { db.exec("ALTER TABLE messages ADD COLUMN steps_json TEXT NOT NULL DEFAULT '[]'"); } catch { /* already there */ }
  // Phase 9 (background processing): on boot, mark stale 'processing' docs and re-queue them.
  g.__db = db;
  return db;
}

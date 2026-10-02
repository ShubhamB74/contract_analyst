import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { config } from "./config";
import type { ChatMessage, DocumentRow, PageSpan } from "./types";

export const newId = () => crypto.randomUUID();

const LIST_COLS = "id,name,mime,status,error,page_count,char_count,created_at";

export const listDocuments = () =>
  getDb().prepare(`SELECT ${LIST_COLS} FROM documents ORDER BY created_at DESC`).all() as DocumentRow[];

export const getDocument = (id: string) =>
  getDb().prepare(`SELECT ${LIST_COLS} FROM documents WHERE id=?`).get(id) as DocumentRow | undefined;

export function getDocumentFull(id: string) {
  const r = getDb().prepare("SELECT * FROM documents WHERE id=?").get(id) as
    | (DocumentRow & { text: string | null; pages_json: string | null; file_path: string | null })
    | undefined;
  if (!r) return undefined;
  return { ...r, text: r.text ?? "", pages: JSON.parse(r.pages_json ?? "[]") as PageSpan[] };
}

export function deleteDocument(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT file_path FROM documents WHERE id=?").get(id) as { file_path?: string } | undefined;
  if (row?.file_path) fs.rmSync(row.file_path, { force: true });
  db.prepare("DELETE FROM documents WHERE id=?").run(id);
  // Conversations that include this doc are orphaned: remove them (messages cascade).
  db.prepare("DELETE FROM conversations WHERE doc_key LIKE ?").run(`%${id}%`);
}

export function saveUpload(id: string, name: string, buf: Buffer) {
  const p = path.join(config.dataDir, "uploads", `${id}${path.extname(name)}`);
  fs.writeFileSync(p, buf);
  return p;
}

export function getOrCreateConversation(docIds: string[]) {
  const db = getDb();
  const key = [...docIds].sort().join(",");
  const found = db.prepare("SELECT id FROM conversations WHERE doc_key=?").get(key) as { id: string } | undefined;
  if (found) return found.id;
  const id = newId();
  db.prepare("INSERT INTO conversations (id, doc_key) VALUES (?,?)").run(id, key);
  return id;
}

export function addMessage(conversationId: string, m: Omit<ChatMessage, "created_at">) {
  getDb()
    .prepare("INSERT INTO messages (id,conversation_id,role,content,quotes_json,coverage_json,status) VALUES (?,?,?,?,?,?,?)")
    .run(m.id, conversationId, m.role, m.content, JSON.stringify(m.quotes), JSON.stringify(m.coverage), m.status);
}

export function listMessages(conversationId: string): ChatMessage[] {
  const rows = getDb().prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY rowid").all(conversationId) as any[];
  return rows.map((r) => ({
    id: r.id, role: r.role, content: r.content, status: r.status, created_at: r.created_at,
    quotes: JSON.parse(r.quotes_json), coverage: JSON.parse(r.coverage_json),
  }));
}

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { extract, detectKind, mimeFor, UserFacingError } from "@/lib/extract";
import { listDocuments, newId, saveUpload } from "@/lib/repo";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(listDocuments());
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  if (file.size > config.maxUploadBytes) {
    return NextResponse.json({ error: `File is larger than ${config.maxUploadBytes / 1024 / 1024} MB.` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let kind: "pdf" | "docx";
  try {
    kind = detectKind(file.name, buf); // reject bad types synchronously with a clear message
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 415 });
  }

  const id = newId();
  const db = getDb();
  const filePath = saveUpload(id, file.name, buf);
  db.prepare("INSERT INTO documents (id,name,mime,status,file_path) VALUES (?,?,?,?,?)")
    .run(id, file.name, mimeFor(kind), "processing", filePath);

  // Fire-and-forget; the client polls GET /api/documents/:id for status.
  // Phase 9: move to a durable job queue so a restart mid-job recovers.
  void (async () => {
    try {
      const r = await extract(file.name, buf);
      db.prepare("UPDATE documents SET status='ready', text=?, pages_json=?, page_count=?, char_count=? WHERE id=?")
        .run(r.text, JSON.stringify(r.pages), r.pageCount, r.text.length, id);
    } catch (e) {
      const msg = e instanceof UserFacingError ? e.message : "Could not read this file. It may be corrupted or password-protected.";
      db.prepare("UPDATE documents SET status='failed', error=? WHERE id=?").run(msg, id);
    }
  })();

  return NextResponse.json({ id }, { status: 202 });
}

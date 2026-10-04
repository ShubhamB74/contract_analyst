import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { detectKind, mimeFor } from "@/lib/extract";
import { processDocument } from "@/lib/jobs";
import { rateLimited } from "@/lib/ratelimit";
import { listDocuments, newId, saveUpload } from "@/lib/repo";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(listDocuments());
}

export async function POST(req: Request) {
  const limited = rateLimited(req, "upload");
  if (limited) return limited;
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

  // Runs in the background; the client polls GET /api/documents/:id. recoverStuckJobs() resumes it after a restart.
  void processDocument(id);

  return NextResponse.json({ id }, { status: 202 });
}

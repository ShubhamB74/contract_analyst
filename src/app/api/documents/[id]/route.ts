import { NextResponse } from "next/server";
import { deleteDocument, getDocumentFull } from "@/lib/repo";
import { invalidateIndex } from "@/lib/answer";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params;
  const d = getDocumentFull(id);
  if (!d) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const { file_path, pages_json, ...rest } = d;
  return NextResponse.json(rest);
}

export async function DELETE(_: Request, { params }: Ctx) {
  const { id } = await params;
  deleteDocument(id);
  invalidateIndex(id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDocument } from "@/lib/repo";
import type { ComparisonView } from "@/lib/compare-types";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getDb().prepare("SELECT * FROM comparisons WHERE id=?").get(id) as
    | { id: string; doc_a: string; doc_b: string; status: ComparisonView["status"]; progress: string | null; error: string | null; result_json: string | null }
    | undefined;
  if (!r) return NextResponse.json({ error: "Comparison not found. The documents may have been deleted." }, { status: 404 });
  const a = getDocument(r.doc_a), b = getDocument(r.doc_b);
  const view: ComparisonView = {
    id: r.id, status: r.status, progress: r.progress, error: r.error,
    docA: { id: r.doc_a, name: a?.name ?? "Deleted document" },
    docB: { id: r.doc_b, name: b?.name ?? "Deleted document" },
    result: r.result_json ? JSON.parse(r.result_json) : null,
  };
  return NextResponse.json(view);
}

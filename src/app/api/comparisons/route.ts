import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDocument, newId } from "@/lib/repo";
import { runComparison } from "@/lib/compare";
import { rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST { olderId, newerId } -> 202 { id }. Poll GET /api/comparisons/:id. */
export async function POST(req: Request) {
  const limited = rateLimited(req, "compare");
  if (limited) return limited;
  const { olderId, newerId } = (await req.json()) as { olderId?: string; newerId?: string };
  if (!olderId || !newerId || olderId === newerId) {
    return NextResponse.json({ error: "Choose two different documents to compare." }, { status: 400 });
  }
  const a = getDocument(olderId), b = getDocument(newerId);
  if (!a || !b) return NextResponse.json({ error: "A selected document no longer exists." }, { status: 404 });
  if (a.status !== "ready" || b.status !== "ready") {
    return NextResponse.json({ error: "Both documents must finish processing first." }, { status: 409 });
  }

  const db = getDb();
  // Re-use an existing finished/running comparison of the same pair instead of paying for it again.
  const existing = db.prepare("SELECT id FROM comparisons WHERE doc_a=? AND doc_b=? AND status IN ('done','running') ORDER BY created_at DESC LIMIT 1")
    .get(olderId, newerId) as { id: string } | undefined;
  if (existing) return NextResponse.json({ id: existing.id }, { status: 200 });

  const id = newId();
  db.prepare("INSERT INTO comparisons (id,doc_a,doc_b,status,progress) VALUES (?,?,?,?,?)").run(id, olderId, newerId, "running", "Starting…");
  void runComparison(id); // background; client polls
  return NextResponse.json({ id }, { status: 202 });
}

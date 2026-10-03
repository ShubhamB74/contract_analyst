import fs from "fs";
import { getDocumentFull } from "@/lib/repo";

export const runtime = "nodejs";

/** Serves the original uploaded file so the browser can render it (PDF.js). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = getDocumentFull(id);
  if (!d?.file_path || !fs.existsSync(d.file_path)) return Response.json({ error: "File not found." }, { status: 404 });
  return new Response(fs.readFileSync(d.file_path), {
    headers: { "Content-Type": d.mime, "Content-Disposition": "inline", "Cache-Control": "private, max-age=3600" },
  });
}

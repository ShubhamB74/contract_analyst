import fs from "fs";
import mammoth from "mammoth";
import { getDocumentFull } from "@/lib/repo";

export const runtime = "nodejs";

/** DOCX -> HTML for the in-app viewer. mammoth builds HTML from the parsed structure (text is escaped). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = getDocumentFull(id);
  if (!d?.file_path || !fs.existsSync(d.file_path) || !d.mime.includes("wordprocessingml")) {
    return Response.json({ error: "No Word file for this document." }, { status: 404 });
  }
  const { value } = await mammoth.convertToHtml({ path: d.file_path });
  // Defence in depth: hyperlinks in a DOCX can carry javascript: URLs.
  const html = value.replace(/href="\s*javascript:[^"]*"/gi, 'href="#"');
  return Response.json({ html });
}

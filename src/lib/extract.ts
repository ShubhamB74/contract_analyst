import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import type { PageSpan } from "./types";

export type Extracted = { text: string; pages: PageSpan[]; pageCount: number };

export class UserFacingError extends Error {}

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Validate by extension AND magic bytes; never trust the browser-supplied MIME alone. */
export function detectKind(name: string, buf: Buffer): "pdf" | "docx" {
  const ext = name.toLowerCase().split(".").pop();
  const isPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (ext === "pdf" && isPdf) return "pdf";
  if (ext === "docx" && isZip) return "docx";
  throw new UserFacingError(
    "Unsupported file. Upload a PDF or a Word (.docx) file. Older .doc files must be re-saved as .docx."
  );
}

export const mimeFor = (k: "pdf" | "docx") => (k === "pdf" ? PDF_MIME : DOCX_MIME);

const MIN_CHARS_PER_PAGE = 20;

export async function extractPdf(buf: Buffer): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text: pageTexts, totalPages } = await extractText(pdf, { mergePages: false });

  const pages: PageSpan[] = [];
  let text = "";
  (pageTexts as string[]).forEach((t, i) => {
    const start = text.length;
    text += t;
    pages.push({ page: i + 1, start, end: text.length });
    text += "\n\n"; // page separator (not part of any page span)
  });

  const readable = text.replace(/\s/g, "").length;
  if (readable < Math.max(50, totalPages * MIN_CHARS_PER_PAGE)) {
    throw new UserFacingError(
      "This PDF has no readable text. It looks like a scanned document. OCR isn't supported yet, so upload a text-based PDF or a DOCX."
    );
  }
  return { text, pages, pageCount: totalPages };
}

export async function extractDocx(buf: Buffer): Promise<Extracted> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  if (value.replace(/\s/g, "").length < 20) {
    throw new UserFacingError("This Word file contains no readable text.");
  }
  // DOCX has no fixed pages; treat as one logical page for now.
  return { text: value, pages: [{ page: 1, start: 0, end: value.length }], pageCount: 1 };
}

export async function extract(name: string, buf: Buffer) {
  const kind = detectKind(name, buf);
  const result = kind === "pdf" ? await extractPdf(buf) : await extractDocx(buf);
  return { kind, ...result };
}

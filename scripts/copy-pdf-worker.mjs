// Copies the pdf.js worker into /public so the browser can load it from a stable URL.
import fs from "fs";
import path from "path";

const src = path.join("node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = path.join("public", "pdf.worker.min.mjs");
if (fs.existsSync(src)) {
  fs.mkdirSync("public", { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("pdf.js worker copied to public/");
} else {
  console.warn("pdfjs-dist not installed yet; skipping worker copy");
}

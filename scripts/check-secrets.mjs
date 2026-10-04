// Run before every push/submission: fails if a real-looking API key or a tracked .env file is found.
import { execSync } from "child_process";
import fs from "fs";

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const bad = [];
if (files.some((f) => /^\.env(\.|$)/.test(f) && f !== ".env.example")) bad.push("a .env file is tracked by git");
const PATTERNS = [/sk-[A-Za-z0-9_-]{20,}/, /sk-or-v1-[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /gsk_[A-Za-z0-9]{20,}/, /(api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i];
for (const f of files) {
  if (/\.(pdf|png|jpg|zip|docx|mjs\.map)$/i.test(f) || f === "package-lock.json" || f === "scripts/check-secrets.mjs") continue;
  let text; try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  for (const p of PATTERNS) if (p.test(text)) bad.push(`${f}: matches ${p}`);
}
if (bad.length) { console.error("Possible secrets found:\n - " + bad.join("\n - ")); process.exit(1); }
console.log(`No secrets found in ${files.length} tracked files.`);

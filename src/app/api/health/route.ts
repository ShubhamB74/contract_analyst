import { getDb } from "@/lib/db";
import { config } from "@/lib/config";

export const runtime = "nodejs";

/** For uptime checks and the library banner. Never returns secrets, only whether they are set. */
export function GET() {
  let db = true;
  try { getDb().prepare("SELECT 1").get(); } catch { db = false; }
  return Response.json({ ok: db, db, aiConfigured: Boolean(config.ai.apiKey), model: config.ai.model });
}

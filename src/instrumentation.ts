// Runs once when the Next.js server starts.
// IMPORTANT: Next bundles this file for BOTH the Node and Edge runtimes. The Node-only code
// (SQLite, fs) lives in instrumentation-node.ts, and the import must sit INSIDE the runtime
// check so the Edge bundle drops it. An early `return` is not enough.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

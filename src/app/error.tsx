"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-10">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-mute">The page hit an unexpected error. Your documents are safe.</p>
      <div className="mt-4 flex gap-3">
        <button onClick={reset} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white">Try again</button>
        <a href="/" className="rounded-md border border-line px-4 py-2 text-sm">Back to library</a>
      </div>
    </main>
  );
}

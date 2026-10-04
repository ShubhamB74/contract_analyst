export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-10">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-mute">That page doesn’t exist, or the document was deleted.</p>
      <a href="/" className="mt-4 inline-block rounded-md bg-ink px-4 py-2 text-sm font-medium text-white">Back to library</a>
    </main>
  );
}

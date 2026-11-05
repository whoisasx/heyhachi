/** Shown inside the (kept) sidebar layout while the next page loads, so a click reacts at once. */
export default function Loading() {
  return (
    <main className="flex-1 overflow-hidden">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10 sm:px-6">
        <span className="h-7 w-40 animate-pulse rounded-lg bg-sunk" />
        <span className="h-4 w-72 animate-pulse rounded bg-sunk" />
        <span className="mt-4 h-16 animate-pulse rounded-xl bg-sunk" />
        <span className="h-16 animate-pulse rounded-xl bg-sunk" />
      </div>
    </main>
  );
}

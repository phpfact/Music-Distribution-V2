// Placeholder blocks in the content area while a console page renders; the
// sidebar and the top bar stay in place around it.
export default function ConsoleLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-8 motion-safe:animate-pulse">
      <div className="flex flex-col gap-3">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-8 w-64 max-w-full rounded-lg bg-surface-2" />
        <div className="h-4 w-80 max-w-full rounded bg-surface-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-32 rounded-xl border border-line bg-surface" />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-line bg-surface" />
    </div>
  );
}

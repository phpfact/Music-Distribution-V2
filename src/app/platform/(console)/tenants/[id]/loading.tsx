// Placeholder blocks shaped like the tenant details page (back link, header,
// the four cards and the history) while it renders.
export default function TenantDetailsLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6 motion-safe:animate-pulse">
      <div className="h-4 w-20 rounded bg-surface-2" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="size-16 shrink-0 rounded-full bg-surface-2" />
          <div className="flex flex-col gap-3">
            <div className="h-8 w-56 max-w-full rounded-lg bg-surface-2" />
            <div className="h-4 w-40 max-w-full rounded bg-surface-2" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-20 rounded-lg bg-surface-2" />
          <div className="h-10 w-28 rounded-lg bg-surface-2" />
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-56 rounded-xl border border-line bg-surface" />
        ))}
      </div>
      <div className="h-48 rounded-xl border border-line bg-surface" />
    </div>
  );
}

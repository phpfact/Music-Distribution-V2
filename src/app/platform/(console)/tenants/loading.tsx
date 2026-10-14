// Placeholder blocks shaped like the tenant list (header, the four figures,
// the toolbar and the rows) while it renders; same approach as the console's.
export default function TenantsLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-8 motion-safe:animate-pulse">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <div className="h-3 w-32 rounded bg-surface-2" />
          <div className="h-8 w-64 max-w-full rounded-lg bg-surface-2" />
          <div className="h-4 w-96 max-w-full rounded bg-surface-2" />
        </div>
        <div className="h-10 w-36 rounded-lg bg-surface-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-32 rounded-xl border border-line bg-surface" />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="h-10 flex-1 rounded-lg bg-surface-2" />
          <div className="h-10 rounded-lg bg-surface-2 sm:w-48" />
        </div>
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="flex items-center gap-4 p-4">
              <div className="size-8 shrink-0 rounded-full bg-surface-2" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-4 w-48 max-w-full rounded bg-surface-2" />
                <div className="h-3 w-32 max-w-full rounded bg-surface-2" />
              </div>
              <div className="hidden h-5 w-20 rounded-full bg-surface-2 sm:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

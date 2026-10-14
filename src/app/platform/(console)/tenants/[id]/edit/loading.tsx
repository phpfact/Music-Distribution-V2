// Placeholder blocks shaped like the edit form (back link, header and the three
// numbered sections) while it renders, so the details page's skeleton one level
// up is not shown here.
export default function EditTenantLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex w-full max-w-3xl flex-col gap-8 motion-safe:animate-pulse"
    >
      <div className="flex flex-col gap-3">
        <div className="h-4 w-28 rounded bg-surface-2" />
        <div className="mt-2 h-3 w-32 rounded bg-surface-2" />
        <div className="h-8 w-48 max-w-full rounded-lg bg-surface-2" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-2" />
      </div>
      <div className="flex flex-col gap-6">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-xl border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line p-5">
              <div className="size-7 shrink-0 rounded-full bg-surface-2" />
              <div className="h-5 w-40 max-w-full rounded bg-surface-2" />
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              {[0, 1].map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <div className="h-4 w-24 rounded bg-surface-2" />
                  <div className="h-10 rounded-lg bg-surface-2" />
                </div>
              ))}
              {index === 0 ? (
                <div className="flex items-center gap-4 sm:col-span-2">
                  <div className="size-16 shrink-0 rounded-full bg-surface-2" />
                  <div className="h-8 w-32 rounded-lg bg-surface-2" />
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <div className="h-10 rounded-lg bg-surface-2 sm:w-24" />
          <div className="h-10 rounded-lg bg-surface-2 sm:w-36" />
        </div>
      </div>
    </div>
  );
}

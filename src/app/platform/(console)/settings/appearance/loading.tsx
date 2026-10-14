export default function AppearanceLoading() {
  return (
    <div role="status" aria-label="Loading appearance settings" className="mx-auto max-w-5xl space-y-6">
      <span className="sr-only">Loading appearance settings…</span>
      <div className="h-8 w-48 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
      <div className="h-[32rem] rounded-2xl border border-line bg-surface motion-safe:animate-pulse" />
    </div>
  );
}

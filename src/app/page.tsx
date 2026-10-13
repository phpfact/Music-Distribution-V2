const healthLinks = [
  { href: "/api/health", label: "Liveness", detail: "/api/health" },
  { href: "/api/health/ready", label: "Readiness", detail: "/api/health/ready" },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Running
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Music Distribution</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The application is up. This is the infrastructure foundation only; no product features
          are implemented yet.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {healthLinks.map((link) => (
          <li key={link.href}>
            {/* Plain anchors: these are JSON API routes, not pages to prefetch. */}
            <a
              href={link.href}
              className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <span className="font-medium">{link.label}</span>
              <code className="text-sm text-zinc-500">{link.detail}</code>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

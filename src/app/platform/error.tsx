"use client";

type PlatformErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

// Shown when a platform page fails to render (for example while the database
// is unreachable). The error itself is deliberately not displayed: its message
// and digest stay in the server log.
export default function PlatformError({ retry }: PlatformErrorProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        The page could not be loaded. Try again shortly.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="w-fit rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        Try again
      </button>
    </main>
  );
}

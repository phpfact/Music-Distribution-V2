"use client";

import { FOCUS_RING } from "./_components/styles";

type ConsoleErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

// Shown inside the console frame when a page fails to render, so the
// navigation stays usable. Like the platform-wide boundary, it deliberately
// does not display the error: its message and digest stay in the server log.
export default function ConsoleError({ retry }: ConsoleErrorProps) {
  return (
    <div role="alert" className="mx-auto mt-6 max-w-lg rounded-2xl border border-line bg-surface p-8">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-fg-muted">The page could not be loaded. Try again shortly.</p>
      <button
        type="button"
        onClick={() => retry()}
        className={`mt-6 inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium transition-colors hover:bg-surface-2 ${FOCUS_RING}`}
      >
        Try again
      </button>
    </div>
  );
}

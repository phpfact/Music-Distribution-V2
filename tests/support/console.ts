import { vi } from "vitest";

const METHODS = ["log", "info", "warn", "error", "debug"] as const;

/**
 * Silences the console and records everything written to it, so a test can
 * assert that a secret was never logged. Undone by `vi.restoreAllMocks()`.
 */
export function captureConsole(): { text: () => string } {
  const lines: string[] = [];
  for (const method of METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (arg instanceof Error ? `${arg.stack}` : String(arg))).join(" "));
    });
  }
  return { text: () => lines.join("\n") };
}

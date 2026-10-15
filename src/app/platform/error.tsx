"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "./(console)/_components/icons";

type PlatformErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

/**
 * Present a safe platform render failure and a retry action.
 * Input: Next.js error-boundary props; raw error details remain in server logs.
 * Output: an accessible shared Alert and Button.
 * Use case: keep a database or rendering outage understandable without leaking errors.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default function PlatformError({ retry }: PlatformErrorProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <Alert variant="destructive">
        <Icon name="alert-triangle" className="size-4" />
        <AlertTitle><h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1></AlertTitle>
        <AlertDescription>The page could not be loaded. Try again shortly.</AlertDescription>
      </Alert>
      <Button
        type="button"
        onClick={() => retry()}
        variant="outline"
        className="w-fit"
      >
        Try again
      </Button>
    </main>
  );
}

"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "./_components/icons";

type ConsoleErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

/**
 * Render a safe content-area failure while retaining the console navigation.
 * Input: Next.js error-boundary props with a retry callback.
 * Output: a shared Alert and retry Button; no raw error or digest is shown.
 * Use case: let platform owners retry a page during a temporary outage.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default function ConsoleError({ retry }: ConsoleErrorProps) {
  return (
    <div className="mx-auto mt-6 max-w-lg space-y-6">
      <Alert variant="destructive">
        <Icon name="alert-triangle" className="size-4" />
        <AlertTitle><h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1></AlertTitle>
        <AlertDescription>The page could not be loaded. Try again shortly.</AlertDescription>
      </Alert>
      <Button
        type="button"
        onClick={() => retry()}
        variant="outline"
      >
        Try again
      </Button>
    </div>
  );
}

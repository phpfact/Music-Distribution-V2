"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Description: Show a friendly error for any failure inside the tenant portal.
 * Input: The error (its message and digest stay in the server log, never shown)
 *   and Next's reset function.
 * Output: A themed card with "Try again" and a link to the welcome page.
 * Use case: Error boundaries of "/" and of /login, /tenant/** and /customer/**
 *   (e.g. the tenant's database is temporarily unreachable).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-4 py-16">
      <Card role="alert">
        <CardHeader>
          <span className="mb-2 grid size-11 place-items-center rounded-xl border bg-background text-destructive">
            <TriangleAlert aria-hidden="true" className="size-5" />
          </span>
          <CardTitle>
            <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
          </CardTitle>
          <CardDescription>
            We couldn’t load this page right now. Please try again in a moment.
          </CardDescription>
        </CardHeader>
        <CardContent />
        <CardFooter className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go to the home page</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

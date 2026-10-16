import { Compass } from "lucide-react";
import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

/**
 * Description: The friendly 404 page of the whole application.
 * Input: None.
 * Output: A card explaining the address does not lead anywhere (status 404).
 *   The wording is generic on purpose: on an unknown or mismatched host it
 *   never names, links to or hints at any tenant.
 * Use case: Any missing route, and "/" or a portal page on a host no tenant
 *   answers to (.vibe/memory/platform-host-gate.md).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <span className="mb-2 grid size-11 place-items-center rounded-xl border bg-background text-muted-foreground">
            <Compass aria-hidden="true" className="size-5" />
          </span>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          </CardTitle>
          <CardDescription>
            This address doesn’t lead to a page or workspace. Check the address for typos, or use the link you were
            given by the organisation that invited you.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

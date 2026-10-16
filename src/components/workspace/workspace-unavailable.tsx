import { Clock, PauseCircle } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type WorkspaceUnavailableProps = {
  /** Why the workspace cannot be used right now. */
  reason: "suspended" | "not_ready";
};

const MESSAGES = {
  suspended: {
    icon: PauseCircle,
    title: "This workspace is temporarily unavailable",
    description: "Access to this workspace has been paused. Please check back later or contact the organisation that runs it.",
  },
  not_ready: {
    icon: Clock,
    title: "This workspace is being set up",
    description: "It will be ready shortly. Please check back in a little while.",
  },
} as const;

/**
 * Description: Tell visitors a known workspace cannot be used right now.
 * Input: The reason (suspended or setup unfinished).
 * Output: A status card. It shows no tenant data at all (not even the name), as
 *   the existing tenant gate requires for tenants that are not "allowed".
 * Use case: "/" on a suspended or unfinished tenant's domain; every portal page
 *   redirects there in that case.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function WorkspaceUnavailable({ reason }: WorkspaceUnavailableProps) {
  const { icon: Icon, title, description } = MESSAGES[reason];

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16 sm:px-6">
      <Card role="status">
        <CardHeader>
          <span className="mb-2 grid size-11 place-items-center rounded-xl border bg-background text-muted-foreground">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

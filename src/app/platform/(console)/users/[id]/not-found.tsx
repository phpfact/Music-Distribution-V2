import Link from "next/link";
import { EmptyState, Icon } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { PLATFORM_RBAC_PATHS } from "../../rbac-actor";

/**
 * Description: Show a safe account-not-found state inside the console.
 * Input: None (Next.js not-found convention).
 * Output: The shared empty state ("Account not found") with a way back to
 *   the Sub-Platform Owners list (a missing account, a malformed id and an
 *   account outside the scope look the same).
 * Use case: Unknown, malformed or out-of-scope ids under /platform/users/<id>/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function SubUserNotFound() {
  return (
    <EmptyState
      icon="user"
      title="Account not found"
      description="This account doesn't exist or is no longer available."
      action={
        <Button asChild variant="outline">
          <Link href={PLATFORM_RBAC_PATHS.users}>
            <Icon name="arrow-left" className="size-4" />
            Back to Sub-Platform Owners
          </Link>
        </Button>
      }
    />
  );
}

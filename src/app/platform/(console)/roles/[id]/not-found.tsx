import Link from "next/link";
import { EmptyState, Icon } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { PLATFORM_RBAC_PATHS } from "../../rbac-actor";

/**
 * Description: Show a safe role-not-found state inside the console.
 * Input: None (Next.js not-found convention).
 * Output: The shared empty state ("Role not found") with a way back to the
 *   roles list (a missing role, a malformed id and a role of another scope look
 *   the same).
 * Use case: Unknown, malformed or out-of-scope ids under /platform/roles/<id>.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function RoleNotFound() {
  return (
    <EmptyState
      icon="shield-check"
      title="Role not found"
      description="This role doesn't exist or is no longer available."
      action={
        <Button asChild variant="outline">
          <Link href={PLATFORM_RBAC_PATHS.roles}>
            <Icon name="arrow-left" className="size-4" />
            Back to roles
          </Link>
        </Button>
      }
    />
  );
}

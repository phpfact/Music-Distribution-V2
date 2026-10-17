import { CrownIcon, LockIcon, ShieldAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RoleStatusValue, UserStatusValue } from "./types";

/**
 * Description: Show a role's status as a badge.
 * Input: The stored status ("active" | "disabled").
 * Output: "Active" (success tone) or "Disabled" (destructive soft tone), theme tokens only.
 * Use case: Roles directory, role details header, role picker helper texts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RoleStatusBadge({ status }: { status: RoleStatusValue }) {
  return status === "active" ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="destructive-soft">Disabled</Badge>
  );
}

/**
 * Description: Show a user account's status as a badge.
 * Input: The stored status ("active" | "disabled").
 * Output: "Active" (success tone) or "Suspended" (destructive soft tone).
 * Use case: Sub-users directory, assigned-user lists and dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function UserStatusBadge({ status }: { status: UserStatusValue }) {
  return status === "active" ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="destructive-soft">Suspended</Badge>
  );
}

/**
 * Description: Mark a system (master) role, which can never be edited or deleted.
 * Input: None.
 * Output: An outline "System" badge with a lock icon (decorative; the text names it).
 * Use case: Roles directory and role details for master roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function SystemRoleBadge() {
  return (
    <Badge variant="outline" title="System role: it always grants every privilege of this panel and cannot be changed.">
      <LockIcon aria-hidden="true" />
      System
    </Badge>
  );
}

/**
 * Description: Mark a master role or a user holding one.
 * Input: None.
 * Output: A brand-tinted "Master" badge with a crown icon.
 * Use case: Role picker options, sub-users directory (role column).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function MasterBadge() {
  return (
    <Badge variant="secondary" className="bg-accent-soft text-primary">
      <CrownIcon aria-hidden="true" />
      Master
    </Badge>
  );
}

/**
 * Description: Mark a role the current user may not manage (delegation ceiling).
 * Input: None.
 * Output: A warning-tone "Above your authority" badge.
 * Use case: Roles directory rows and role details of roles with privileges the
 *   viewer does not hold (they can view them but not edit, disable or delete).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function AboveAuthorityBadge() {
  return (
    <Badge variant="warning" title="This role grants privileges you do not have, so you cannot change it.">
      <ShieldAlertIcon aria-hidden="true" />
      Above your authority
    </Badge>
  );
}

/**
 * Description: Mark the panel's primary account (never suspended or reassigned here).
 * Input: None.
 * Output: A neutral "Primary" badge.
 * Use case: Sub-users directory name column.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function PrimaryBadge() {
  return <Badge variant="secondary">Primary</Badge>;
}

/**
 * Description: Mark the signed-in user's own row.
 * Input: None.
 * Output: An outline "You" badge.
 * Use case: Sub-users directory name column (nobody can change their own role or status).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function SelfBadge() {
  return <Badge variant="outline">You</Badge>;
}

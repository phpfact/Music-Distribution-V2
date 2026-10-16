import { Ban, CircleCheck, CircleX, Clock, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { REGISTRATION_STATUS_LABELS, type RegistrationDisplayStatus } from "@/lib/workspace/rules";

const BADGES = {
  pending:          { variant: "warning",          icon: Clock },
  review_requested: { variant: "info",             icon: RotateCcw },
  active:           { variant: "success",          icon: CircleCheck },
  suspended:        { variant: "secondary",        icon: Ban },
  rejected:         { variant: "destructive-soft", icon: CircleX },
} as const;

/**
 * Description: Show a registration's status as a badge (icon + text, never colour alone).
 * Input: The display status.
 * Output: A themed badge: Pending, Review requested, Active, Suspended or Rejected.
 * Use case: Registrations lists, popups and the tenant dashboard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RegistrationStatusBadge({ status }: { status: RegistrationDisplayStatus }) {
  const { variant, icon: Icon } = BADGES[status];
  return (
    <Badge variant={variant} className="gap-1">
      <Icon aria-hidden="true" />
      {REGISTRATION_STATUS_LABELS[status]}
    </Badge>
  );
}

"use client";

import { BanIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { RoleDeleteDialog, RoleStatusDialog, type DialogRole } from "@/components/rbac/role-dialogs";
import type { AssignedUserView, RbacActionResult, RoleOptionView, LoadRoleOptions, RoleStatusValue } from "@/components/rbac/types";
import { Button } from "@/components/ui/button";
import { withRbacNotice } from "./notices";

type RoleDetailsActionsProps = {
  /** The role shown on the details page. */
  role: DialogRole;
  /** The role details path (status changes come back here with a notice). */
  detailsHref: string;
  /** The roles list path (a deleted role leads back here with a notice). */
  listHref: string;
  /** Edit is offered (role manageable + `*.roles.edit`; decided by the server). */
  canEdit: boolean;
  /** Delete is offered (role manageable + `*.roles.delete`; decided by the server). */
  canDelete: boolean;
  /**
   * Bound action: switches the role to `next` ("disabled" when it is shown
   * active, "active" when shown disabled; RoleStatusDialog computes it).
   */
  toggleStatusAction?: (roleId: string, next: RoleStatusValue) => Promise<RbacActionResult>;
  /** Bound action: deletes the role, reassigning its users to the replacement. */
  deleteAction?: (roleId: string, replacementRoleId: string | null) => Promise<RbacActionResult>;
  /** Active roles the viewer may assign (delete-and-reassign choices). */
  replacementRoles: readonly RoleOptionView[];
  /** Scoped database search for later replacement options. */
  loadReplacementRoles?: LoadRoleOptions;
  /** The first page of the role's holders (named in the confirmations). */
  affectedUsers: readonly AssignedUserView[];
};

/**
 * Description: The header actions of a role details page of any panel (UI spec
 *   "Role details": "the same actions" as the directory row).
 * Input: The role, its paths, what the server allows, the bound actions, the
 *   replacement roles and the affected users.
 * Output: Edit (link), Disable/Enable and Delete buttons — each only when the
 *   server allowed it. Disable/Enable and Delete open the shared confirmation
 *   dialogs (affected users, required replacement role). After a status change
 *   the page reloads its server data with a one-off notice (no full reload);
 *   after a delete it moves to the roles list with a notice.
 * Use case: /platform/roles/[id], /tenant/roles/[id] and /customer/roles/[id].
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RoleDetailsActions({
  role,
  detailsHref,
  listHref,
  canEdit,
  canDelete,
  toggleStatusAction,
  deleteAction,
  replacementRoles,
  loadReplacementRoles,
  affectedUsers,
}: RoleDetailsActionsProps) {
  const router                 = useRouter();
  const [, startTransition]    = useTransition();
  const [dialog, setDialog]    = useState<"status" | "delete" | null>(null);
  const statusButtonRef        = useRef<HTMLButtonElement>(null);
  const deleteButtonRef        = useRef<HTMLButtonElement>(null);

  // Step 1: what may be offered (the server re-checks every action anyway).
  const showStatus = canEdit && toggleStatusAction !== undefined;
  const showDelete = canDelete && deleteAction !== undefined;
  const disabling  = role.status === "active";

  // Nothing to offer: the header shows no action group at all.
  if (!canEdit && !showStatus && !showDelete) return null;

  return (
    <>
      {canEdit ? (
        <Button asChild variant="outline">
          <Link href={`${detailsHref}/edit`}>
            <PencilIcon aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}
      {showStatus ? (
        <Button ref={statusButtonRef} type="button" variant="outline" onClick={() => setDialog("status")}>
          {disabling ? <BanIcon aria-hidden="true" /> : <RotateCcwIcon aria-hidden="true" />}
          {disabling ? "Disable" : "Enable"}
        </Button>
      ) : null}
      {showDelete ? (
        <Button ref={deleteButtonRef} type="button" variant="destructive" onClick={() => setDialog("delete")}>
          <Trash2Icon aria-hidden="true" />
          Delete
        </Button>
      ) : null}

      {toggleStatusAction ? (
        <RoleStatusDialog
          role={dialog === "status" ? role : null}
          onClose={() => setDialog(null)}
          onConfirm={toggleStatusAction}
          // The fresh status and the notice come from the server (only this page's data reloads).
          onDone={() =>
            startTransition(() => router.replace(withRbacNotice(detailsHref, disabling ? "role-disabled" : "role-enabled"), { scroll: false }))
          }
          returnFocusRef={statusButtonRef}
          affectedUsers={affectedUsers}
        />
      ) : null}
      {deleteAction ? (
        <RoleDeleteDialog
          role={dialog === "delete" ? role : null}
          onClose={() => setDialog(null)}
          replacementRoles={replacementRoles}
          loadReplacementRoles={loadReplacementRoles}
          onConfirm={deleteAction}
          // The role no longer exists: continue on the list with a notice.
          onDone={() => startTransition(() => router.replace(withRbacNotice(listHref, "role-deleted")))}
          returnFocusRef={deleteButtonRef}
          affectedUsers={affectedUsers}
        />
      ) : null}
    </>
  );
}

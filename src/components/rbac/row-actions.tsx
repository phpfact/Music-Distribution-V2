"use client";

import { BanIcon, EllipsisIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoleDeleteDialog, RoleStatusDialog } from "./role-dialogs";
import type {
  AssignedUserView,
  RbacActionResult,
  RecordsResult,
  RoleOptionView,
  RoleRowView,
  RoleStatusValue,
  SubUserRowView,
  UserStatusChange,
} from "./types";

// Shown when a Server Action itself could not be reached.
const ACTION_FAILED = "The change could not be saved. Check your connection and try again.";

type RoleRowActionsProps = {
  row: RoleRowView;
  /** The roles list path; View = `${basePath}/${id}`, Edit = `${basePath}/${id}/edit`. */
  basePath: string;
  /** The viewer holds `*.roles.edit` (edit, disable/enable). */
  canEdit: boolean;
  /** The viewer holds `*.roles.delete`. */
  canDelete: boolean;
  /**
   * Bound action: switches the role to `next` ("disabled" when the row shows
   * it active, "active" when it shows it disabled; RoleStatusDialog computes it).
   */
  toggleStatusAction?: (roleId: string, next: RoleStatusValue) => Promise<RbacActionResult>;
  /** Bound action: deletes the role, reassigning its users to the replacement. */
  deleteAction?: (roleId: string, replacementRoleId: string | null) => Promise<RbacActionResult>;
  /** Active roles the viewer may assign (delete-and-reassign choices). */
  replacementRoles: readonly RoleOptionView[];
  /** Loads the users holding a role (affected users in the dialogs). */
  loadUsers?: (roleId: string, page: number) => Promise<RecordsResult<AssignedUserView>>;
  /** Called with the success message after a change. */
  onDone: (message: string) => void;
};

/**
 * Description: The actions of one roles-directory row.
 * Input: The row, the list path, the viewer's permissions, the bound actions,
 *   the replacement roles, the users loader and the success callback.
 * Output: A "View" link, plus (only when the role is manageable and the
 *   viewer is permitted) a menu with Edit, Disable/Enable and Delete; the
 *   latter two open their confirmation dialogs. Master roles and roles above
 *   the viewer's authority only get "View".
 * Use case: RolesDirectory table rows and cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RoleRowActions({
  row,
  basePath,
  canEdit,
  canDelete,
  toggleStatusAction,
  deleteAction,
  replacementRoles,
  loadUsers,
  onDone,
}: RoleRowActionsProps) {
  const [dialog, setDialog] = useState<"status" | "delete" | null>(null);
  const triggerRef  = useRef<HTMLButtonElement>(null);
  const detailsHref = `${basePath}/${row.id}`;

  // Step 1: what the menu may offer (the server re-checks every action).
  const editable     = row.manageable && !row.isMaster;
  const showEdit     = editable && canEdit;
  const showStatus   = editable && canEdit && toggleStatusAction !== undefined;
  const showDelete   = editable && canDelete && deleteAction !== undefined;
  const hasMenu      = showEdit || showStatus || showDelete;
  const dialogRole   = { id: row.id, name: row.name, status: row.status, userCount: row.userCount };
  const loadAffected = loadUsers ? (roleId: string) => loadUsers(roleId, 1) : undefined;

  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="sm" className="text-primary">
        <Link href={detailsHref} aria-label={`View ${row.name}`}>
          View
        </Link>
      </Button>
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label={`More actions for ${row.name}`}
            >
              <EllipsisIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48"
            onCloseAutoFocus={(event) => {
              // The newly opened confirmation owns focus until it closes.
              if (dialog !== null) event.preventDefault();
            }}
          >
            {showEdit ? (
              <DropdownMenuItem asChild>
                <Link href={`${detailsHref}/edit`}>
                  <PencilIcon aria-hidden="true" />
                  Edit
                </Link>
              </DropdownMenuItem>
            ) : null}
            {showStatus ? (
              <DropdownMenuItem onSelect={() => setDialog("status")}>
                {row.status === "active" ? <BanIcon aria-hidden="true" /> : <RotateCcwIcon aria-hidden="true" />}
                {row.status === "active" ? "Disable" : "Enable"}
              </DropdownMenuItem>
            ) : null}
            {showDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                  <Trash2Icon aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {toggleStatusAction ? (
        <RoleStatusDialog
          role={dialog === "status" ? dialogRole : null}
          onClose={() => setDialog(null)}
          onConfirm={toggleStatusAction}
          onDone={onDone}
          returnFocusRef={triggerRef}
          loadAffectedUsers={loadAffected}
        />
      ) : null}
      {deleteAction ? (
        <RoleDeleteDialog
          role={dialog === "delete" ? dialogRole : null}
          onClose={() => setDialog(null)}
          replacementRoles={replacementRoles}
          onConfirm={deleteAction}
          onDone={onDone}
          returnFocusRef={triggerRef}
          loadAffectedUsers={loadAffected}
        />
      ) : null}
    </div>
  );
}

type SubUserRowActionsProps = {
  row: SubUserRowView;
  /** The sub-users list path; Edit = `${basePath}/${id}/edit`. */
  basePath: string;
  /** The viewer holds the panel's `users.edit` / `sub_customers.edit`. */
  canEdit: boolean;
  /** The viewer holds the panel's `users.suspend` / `sub_customers.suspend`. */
  canSuspend: boolean;
  /**
   * Bound action: makes `change` ("suspend" when the row shows the account
   * active, "reactivate" when it shows it suspended).
   */
  toggleStatusAction?: (userId: string, change: UserStatusChange) => Promise<RbacActionResult>;
  /** Called with the success message after a change. */
  onDone: (message: string) => void;
};

/**
 * Description: The actions of one sub-users-directory row.
 * Input: The row, the list path, the viewer's permissions, the bound
 *   suspend/reactivate action and the success callback.
 * Output: Edit (link) and Suspend/Reactivate (with confirmation) only when the
 *   row is manageable (never primary accounts or the viewer's own row) and the
 *   viewer is permitted; otherwise a short muted note.
 * Use case: SubUsersDirectory table rows and cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function SubUserRowActions({ row, basePath, canEdit, canSuspend, toggleStatusAction, onDone }: SubUserRowActionsProps) {
  const [open, setOpen]       = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const running = useRef(false);

  // Step 1: what may be offered (primary accounts and the viewer's own row never).
  const manageable = row.manageable && !row.isPrimary && !row.isSelf;
  const showEdit   = manageable && canEdit;
  const showStatus = manageable && canSuspend && toggleStatusAction !== undefined;
  const suspending = row.status === "active";

  /**
   * Description: Run the confirmed suspend/reactivate once.
   * Input: None (reads the row; the change is "suspend" for an active row,
   *   "reactivate" for a suspended one).
   * Output: Success: dialog closes and onDone gets the message; failure: friendly error in the dialog.
   * Use case: ConfirmDialog onConfirm.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  async function confirm() {
    if (!toggleStatusAction || running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      // The intended change follows the status this row shows; the service refuses
      // it when the account is already in that state (stale page → "refresh").
      const result = await toggleStatusAction(row.id, suspending ? "suspend" : "reactivate");
      if (result.ok) {
        setOpen(false);
        onDone(result.message);
      } else {
        setError(result.error);
      }
    } catch {
      setError(ACTION_FAILED);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  if (!showEdit && !showStatus) {
    return (
      <p className="text-right text-xs text-muted-foreground">
        {row.isSelf ? "Your own account" : row.isPrimary ? "Primary account" : "No actions available"}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {showEdit ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`${basePath}/${row.id}/edit`} aria-label={`Edit ${row.fullName}`}>
            <PencilIcon aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}
      {showStatus ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          aria-label={`${suspending ? "Suspend" : "Reactivate"} ${row.fullName}`}
        >
          {suspending ? <BanIcon aria-hidden="true" /> : <RotateCcwIcon aria-hidden="true" />}
          {suspending ? "Suspend" : "Reactivate"}
        </Button>
      ) : null}
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title={suspending ? `Suspend ${row.fullName}?` : `Reactivate ${row.fullName}?`}
        description={
          suspending
            ? `${row.fullName} is signed out everywhere and cannot log in until the account is reactivated.`
            : `${row.fullName} can log in again with the role ${row.roleName}.`
        }
        confirmLabel={suspending ? "Suspend" : "Reactivate"}
        confirmVariant={suspending ? "danger" : "primary"}
        pending={pending}
        error={error}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}

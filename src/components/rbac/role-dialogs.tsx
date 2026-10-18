"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ConfirmDialog, describedBy, Field, Notice } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AffectedUsersPreview, AFFECTED_USERS_PREVIEW } from "./assigned-users";
import { countText } from "./format";
import { ROLE_PICKER_HINT, RolePicker } from "./role-picker";
import type { AssignedUserView, RbacActionResult, RecordsResult, RoleOptionView, LoadRoleOptions, RoleStatusValue } from "./types";

// Shown when a Server Action itself could not be reached.
const ACTION_FAILED = "The change could not be saved. Check your connection and try again.";
// Shown when the affected users could not be loaded.
const USERS_FAILED  = "The affected users could not be loaded. Try again.";

/** The role a dialog acts on. */
export type DialogRole = {
  id: string;
  name: string;
  status: RoleStatusValue;
  /** How many users hold the role. */
  userCount: number;
};

/** Where the affected users come from: passed in, or loaded when the dialog opens. */
type AffectedUsersSource = {
  /** The users holding the role (role details page already has them). */
  affectedUsers?: readonly AssignedUserView[];
  /** Loads the first page of users holding the role (roles directory). */
  loadAffectedUsers?: (roleId: string) => Promise<RecordsResult<AssignedUserView>>;
};

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; users: readonly AssignedUserView[]; total: number }
  | { status: "error"; message: string };

/**
 * Description: Show the users a role change affects (first 10 + "and N more").
 * Input: The role, and either the users or a loader (loaded once on mount; the
 *   parent mounts this only while the dialog is open, keyed by role).
 * Output: Nothing when nobody holds the role; otherwise a skeleton while
 *   loading, the preview list, or an error with Retry.
 * Use case: Disable/enable and delete confirmations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function AffectedUsers({ role, affectedUsers, loadAffectedUsers }: { role: DialogRole } & AffectedUsersSource) {
  // Users passed in need no loading; otherwise start in the loading state.
  const [state, setState] = useState<LoadState>(() =>
    affectedUsers || !loadAffectedUsers
      ? { status: "loaded", users: affectedUsers ?? [], total: role.userCount }
      : { status: "loading" },
  );
  const [attempt, setAttempt] = useState(0);

  // Load the first page of holders when no list was passed (an obsolete answer is ignored).
  useEffect(() => {
    if (affectedUsers || !loadAffectedUsers || role.userCount === 0) return;
    let obsolete = false;
    loadAffectedUsers(role.id)
      .then((result) => {
        if (obsolete) return;
        setState(
          result.ok
            ? { status: "loaded", users: result.page.rows, total: result.page.total }
            : { status: "error", message: result.error },
        );
      })
      .catch(() => {
        if (!obsolete) setState({ status: "error", message: USERS_FAILED });
      });
    return () => {
      obsolete = true;
    };
  }, [affectedUsers, loadAffectedUsers, role.id, role.userCount, attempt]);

  if (role.userCount === 0) return null;
  if (state.status === "loading") {
    return (
      <div role="status" aria-label="Loading the affected users" className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-2">
        <Notice variant="error">{state.message}</Notice>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  return <AffectedUsersPreview users={state.users.slice(0, AFFECTED_USERS_PREVIEW)} total={state.total} />;
}

type RoleStatusDialogProps = AffectedUsersSource & {
  /** The role to disable (when active) or enable (when disabled); null = closed. */
  role: DialogRole | null;
  onClose: () => void;
  /**
   * The panel's bound action: switches the role to `next` — "disabled" when the
   * dialog's role is active, "active" when it is disabled (computed here from
   * the shown status; the service refuses a stale change).
   */
  onConfirm: (roleId: string, next: RoleStatusValue) => Promise<RbacActionResult>;
  /** Called with the success message after the change (e.g. show a notice + router.refresh()). */
  onDone: (message: string) => void;
  /** A stable control to focus after closing (e.g. the row menu trigger). */
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Description: Confirm disabling or enabling a role, naming the affected users.
 * Input: The role (null = closed), the users source, the bound action and callbacks.
 * Output: A ConfirmDialog. Disable: "N users lose all protected access on
 *   their next request…", destructive "Disable role". Enable: "N users get the
 *   role's privileges again…", "Enable role". Lists the first 10 affected users
 *   + "and N more"; pending state blocks repeat clicks; friendly errors stay in
 *   the dialog.
 * Use case: Roles directory row menu and role details actions (edit privilege).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RoleStatusDialog({
  role,
  onClose,
  onConfirm,
  onDone,
  returnFocusRef,
  affectedUsers,
  loadAffectedUsers,
}: RoleStatusDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  // Synchronous guard against a double click before React re-renders.
  const running = useRef(false);

  const disabling = role?.status === "active";
  const users     = role ? countText(role.userCount, "user", "users") : "";

  /**
   * Description: Run the confirmed disable/enable once.
   * Input: None (reads the role; asks for "disabled" when it is shown active,
   *   "active" when it is shown disabled).
   * Output: Success: the dialog closes and onDone gets the message. Failure:
   *   the friendly error stays in the dialog.
   * Use case: ConfirmDialog onConfirm.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  async function confirm() {
    if (!role || running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      // The intended status is the opposite of the one shown (never a blind toggle).
      const result = await onConfirm(role.id, disabling ? "disabled" : "active");
      if (result.ok) {
        onClose();
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

  return (
    <ConfirmDialog
      open={role !== null}
      onClose={() => {
        setError(null);
        onClose();
      }}
      returnFocusRef={returnFocusRef}
      title={disabling ? `Disable the role “${role?.name ?? ""}”?` : `Enable the role “${role?.name ?? ""}”?`}
      description={
        disabling
          ? `${users} lose all protected access on their next request, until they get another role or this role is enabled again.`
          : `${users} get this role's privileges again on their next request.`
      }
      confirmLabel={disabling ? "Disable role" : "Enable role"}
      confirmVariant={disabling ? "danger" : "primary"}
      pending={pending}
      error={error}
      onConfirm={() => void confirm()}
    >
      {role ? (
        <AffectedUsers key={role.id} role={role} affectedUsers={affectedUsers} loadAffectedUsers={loadAffectedUsers} />
      ) : null}
    </ConfirmDialog>
  );
}

type RoleDeleteDialogProps = AffectedUsersSource & {
  /** The role to delete; null = closed. */
  role: DialogRole | null;
  onClose: () => void;
  /** Active roles the actor may assign (the role itself is excluded automatically). */
  replacementRoles: readonly RoleOptionView[];
  /** Scoped database search for later replacement options. */
  loadReplacementRoles?: LoadRoleOptions;
  /**
   * The panel's bound action. `replacementRoleId` is null when nobody holds
   * the role; otherwise exactly one role id (reassign + delete in one transaction).
   */
  onConfirm: (roleId: string, replacementRoleId: string | null) => Promise<RbacActionResult>;
  /** Called with the success message (e.g. navigate back to the list or refresh). */
  onDone: (message: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Description: Confirm deleting a role; a role with users requires a replacement role.
 * Input: The role (null = closed), the replacement choices, the users source,
 *   the bound action and callbacks.
 * Output: A ConfirmDialog. Without users: "Delete role". With users: the
 *   affected users (first 10 + "and N more") and a required, searchable
 *   single-role picker; the button reads "Delete and reassign" and is refused
 *   with an error under the picker until a role is chosen. Never a silent
 *   fallback. Pending state and friendly errors as in every dialog.
 * Use case: Roles directory row menu and role details actions (delete privilege).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RoleDeleteDialog({
  role,
  onClose,
  replacementRoles,
  loadReplacementRoles,
  onConfirm,
  onDone,
  returnFocusRef,
  affectedUsers,
  loadAffectedUsers,
}: RoleDeleteDialogProps) {
  const [pending, setPending]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [replacement, setReplacement]   = useState("");
  const [pickerError, setPickerError]   = useState<string | null>(null);
  const running   = useRef(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const pickerId  = `${useId()}-replacement`;

  const needsReplacement = (role?.userCount ?? 0) > 0;

  /**
   * Description: Reset the dialog's own state and close it.
   * Input: None.
   * Output: Replacement choice and errors cleared; onClose called.
   * Use case: Cancel, Escape, outside click, and after success.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function close() {
    setReplacement("");
    setPickerError(null);
    setError(null);
    onClose();
  }

  /**
   * Description: Validate the replacement and run the delete once.
   * Input: None (reads the role and the chosen replacement).
   * Output: Missing replacement: error under the picker, picker focused.
   *   Success: dialog closes, onDone gets the message. Failure: friendly error.
   * Use case: ConfirmDialog onConfirm.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  async function confirm() {
    if (!role || running.current) return;

    // Step 1: a role in use can only be deleted with exactly one replacement.
    if (needsReplacement && replacement === "") {
      setPickerError("Choose the role these users get instead.");
      pickerRef.current?.focus();
      return;
    }

    // Step 2: run the action once.
    running.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(role.id, needsReplacement ? replacement : null);
      if (result.ok) {
        close();
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

  return (
    <ConfirmDialog
      open={role !== null}
      onClose={close}
      returnFocusRef={returnFocusRef}
      title={`Delete the role “${role?.name ?? ""}”?`}
      description={
        needsReplacement
          ? `${countText(role?.userCount ?? 0, "user holds", "users hold")} this role. Choose the role they get instead; they are reassigned and the role is deleted together. This cannot be undone.`
          : "Nobody holds this role. It is deleted permanently. This cannot be undone."
      }
      confirmLabel={needsReplacement ? "Delete and reassign" : "Delete role"}
      confirmVariant="danger"
      pending={pending}
      error={error}
      onConfirm={() => void confirm()}
    >
      {role ? (
        <>
          <AffectedUsers key={role.id} role={role} affectedUsers={affectedUsers} loadAffectedUsers={loadAffectedUsers} />
          {needsReplacement ? (
            <Field label="Replacement role" htmlFor={pickerId} required hint={ROLE_PICKER_HINT} error={pickerError}>
              <RolePicker
                ref={pickerRef}
                id={pickerId}
                name="replacementRoleId"
                roles={replacementRoles}
                loadRoles={loadReplacementRoles}
                excludeIds={[role.id]}
                value={replacement}
                onValueChange={(value) => {
                  setReplacement(value);
                  setPickerError(null);
                }}
                disabled={pending}
                invalid={Boolean(pickerError)}
                aria-describedby={describedBy(pickerId, { hint: true, error: pickerError })["aria-describedby"]}
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </ConfirmDialog>
  );
}
